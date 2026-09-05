"""WebSocket endpoint for participant screen-review signaling.

Authentication: first-message auth pattern (same as instructor WS).
    1. Client opens WebSocket connection.
    2. Server accepts but sends no data yet.
    3. Client sends: {"type": "authenticate", "access_token": "<participant token>"}
    4. Server validates token and either:
       - Sends {"type": "authenticated"} and registers connection
       - Closes with code 4401 (bad token)

Security:
    - No token in URL/query string
    - Instructor tokens CANNOT authenticate participant WebSockets
    - Refresh tokens CANNOT authenticate participant WebSockets
    - Participant identity is derived from the JWT, NOT from message fields
    - Each participant can only signal for their own screen-review requests
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.security import verify_participant_token, TokenError
from app.core.database import SessionLocal
from app.repositories.participant_repository import ParticipantRepository
from app.services.screen_review_manager import (
    ScreenReviewStatus,
    screen_review_manager,
)

logger = logging.getLogger(__name__)

# Authentication timeout in seconds
WS_AUTH_TIMEOUT_SECONDS = 10

# SDP size limits
MAX_SDP_SIZE = 10_240  # 10 KB
MAX_CANDIDATE_SIZE = 1024  # 1 KB

# Total incoming message size limit — oversized frames are ignored so the
# signaling loop survives and the connection stays usable
_MAX_WS_MESSAGE_SIZE = 65_536  # 64 KB

router = APIRouter()


@router.websocket("/ws/participant-screen-review")
async def participant_screen_review_ws(websocket: WebSocket):
    """WebSocket endpoint for participant screen-review signaling.

    Connection flow:
    1. Accept connection.
    2. Wait for auth message (with timeout).
    3. Validate token type == 'participant'.
    4. Verify participant session exists in DB.
    5. Register connection in ScreenReviewManager.
    6. Handle signaling messages until disconnect.
    """
    await websocket.accept()

    authenticated = False
    participant_session_id: str | None = None

    try:
        # --- Authentication phase ---
        try:
            auth_message = await asyncio.wait_for(
                websocket.receive_json(), timeout=WS_AUTH_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            await websocket.close(code=4401, reason="Authentication timeout")
            return

        if (
            not isinstance(auth_message, dict)
            or auth_message.get("type") != "authenticate"
        ):
            await websocket.close(
                code=4401, reason="Expected authenticate message"
            )
            return

        access_token = auth_message.get("access_token")
        if not access_token or not isinstance(access_token, str):
            await websocket.close(code=4401, reason="Missing access_token")
            return

        # Validate token — must be participant token
        try:
            payload = verify_participant_token(access_token)
        except TokenError:
            await websocket.close(
                code=4401, reason="Invalid or expired token"
            )
            return

        participant_session_id = payload["sub"]

        # Verify participant session exists in DB
        try:
            db = SessionLocal()
            repo = ParticipantRepository(db)
            participant = repo.get_participant_by_psid(
                participant_session_id
            )
            db.close()
        except Exception:
            await websocket.close(code=4401, reason="Database error")
            return

        if not participant:
            await websocket.close(
                code=4404, reason="Participant session not found"
            )
            return

        # Authentication successful
        await websocket.send_json({"type": "authenticated"})

        # Register in ScreenReviewManager
        await screen_review_manager.register_participant_ws(
            participant_session_id, websocket
        )
        authenticated = True

        # --- Signaling phase ---
        while True:
            try:
                raw = await websocket.receive_text()
            except WebSocketDisconnect:
                break
            except Exception:
                break

            if len(raw) > _MAX_WS_MESSAGE_SIZE:
                continue

            try:
                data = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                continue

            if not isinstance(data, dict):
                continue

            msg_type = data.get("type")

            # --- Accept / Decline ---
            if msg_type in ("screen_review_accepted", "screen_review_declined"):
                review_id = data.get("screen_review_id")
                if not isinstance(review_id, str) or not review_id:
                    continue

                request = await screen_review_manager.get_request(review_id)
                if request is None:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Unknown screen_review_id",
                    })
                    continue

                # Validate participant owns this request
                if (
                    request.participant_session_id
                    != participant_session_id
                ):
                    await websocket.send_json({
                        "type": "error",
                        "message": "Not authorized for this review",
                    })
                    continue

                if msg_type == "screen_review_accepted":
                    if request.status != ScreenReviewStatus.REQUESTED:
                        continue
                    await screen_review_manager.update_status(
                        review_id, ScreenReviewStatus.ACCEPTED
                    )
                    # Notify instructor
                    await screen_review_manager.send_to_instructor(
                        request,
                        {
                            "type": "screen_review_status",
                            "screen_review_id": review_id,
                            "status": "accepted",
                            "participant_session_id": (
                                request.participant_session_id
                            ),
                        },
                    )
                else:  # declined
                    if request.status != ScreenReviewStatus.REQUESTED:
                        continue
                    await screen_review_manager.update_status(
                        review_id, ScreenReviewStatus.DECLINED
                    )
                    await screen_review_manager.send_to_instructor(
                        request,
                        {
                            "type": "screen_review_status",
                            "screen_review_id": review_id,
                            "status": "declined",
                            "participant_session_id": (
                                request.participant_session_id
                            ),
                        },
                    )

            # --- SDP Offer (participant creates the offer) ---
            elif msg_type == "screen_review_offer":
                review_id = data.get("screen_review_id")
                sdp = data.get("sdp")

                if (
                    not isinstance(review_id, str)
                    or not isinstance(sdp, str)
                    or len(sdp) > MAX_SDP_SIZE
                ):
                    continue

                request = await screen_review_manager.get_request(review_id)
                if request is None:
                    continue
                if (
                    request.participant_session_id
                    != participant_session_id
                ):
                    continue
                if request.status != ScreenReviewStatus.ACCEPTED:
                    continue

                # Relay offer to instructor
                await screen_review_manager.send_to_instructor(
                    request,
                    {
                        "type": "screen_review_offer",
                        "screen_review_id": review_id,
                        "sdp": sdp,
                    },
                )

            # --- ICE Candidate ---
            elif msg_type == "screen_review_ice_candidate":
                review_id = data.get("screen_review_id")
                candidate = data.get("candidate")
                sdp_mid = data.get("sdpMid")
                sdp_mline_index = data.get("sdpMLineIndex")

                if (
                    not isinstance(review_id, str)
                    or not isinstance(candidate, str)
                    or len(candidate) > MAX_CANDIDATE_SIZE
                ):
                    continue

                request = await screen_review_manager.get_request(review_id)
                if request is None:
                    continue
                if (
                    request.participant_session_id
                    != participant_session_id
                ):
                    continue
                if request.status in {
                    ScreenReviewStatus.DECLINED,
                    ScreenReviewStatus.STOPPED,
                    ScreenReviewStatus.EXPIRED,
                    ScreenReviewStatus.FAILED,
                }:
                    continue

                # Relay ICE candidate to instructor
                await screen_review_manager.send_to_instructor(
                    request,
                    {
                        "type": "screen_review_ice_candidate",
                        "screen_review_id": review_id,
                        "candidate": candidate,
                        "sdpMid": sdp_mid,
                        "sdpMLineIndex": sdp_mline_index,
                    },
                )

            # --- Stopped (student ended sharing) ---
            elif msg_type == "screen_review_stopped":
                review_id = data.get("screen_review_id")
                if not isinstance(review_id, str):
                    continue

                request = await screen_review_manager.get_request(review_id)
                if request is None:
                    continue
                if (
                    request.participant_session_id
                    != participant_session_id
                ):
                    continue

                await screen_review_manager.update_status(
                    review_id, ScreenReviewStatus.STOPPED
                )
                await screen_review_manager.send_to_instructor(
                    request,
                    {
                        "type": "screen_review_status",
                        "screen_review_id": review_id,
                        "status": "stopped",
                        "participant_session_id": (
                            request.participant_session_id
                        ),
                    },
                )

            # --- Ping/pong ---
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("Participant screen review WS error: %s", exc)
    finally:
        if authenticated and participant_session_id:
            await screen_review_manager.unregister_participant_ws(
                participant_session_id
            )
            # Clean up any active reviews for this participant
            cleaned = await screen_review_manager.cleanup_by_participant(
                participant_session_id
            )
            # Notify instructors of stopped reviews
            for req in cleaned:
                try:
                    await screen_review_manager.send_to_instructor(
                        req,
                        {
                            "type": "screen_review_status",
                            "screen_review_id": req.screen_review_id,
                            "status": "stopped",
                            "participant_session_id": (
                                req.participant_session_id
                            ),
                        },
                    )
                except Exception:
                    pass
