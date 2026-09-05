"""WebSocket endpoint for real-time monitoring event delivery.

Authentication: first-message auth pattern.
    1. Client opens WebSocket connection.
    2. Server accepts but sends no data yet.
    3. Client sends: {"type": "authenticate", "access_token": "<instructor access token>"}
    4. Server validates token + ownership and either:
       - Sends {"type": "authenticated", "monitoring_session_id": <id>} and registers connection
       - Closes with code 4401 (bad token) or 4404 (not owner)

Security:
    - No token in URL/query string (browser WebSockets cannot set Authorization headers)
    - Participant tokens CANNOT authenticate instructor WebSockets
    - Refresh tokens CANNOT authenticate instructor WebSockets
    - Unauthenticated connections receive no event data
    - Short auth timeout prevents lingering unauthenticated connections
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.security import verify_access_token, TokenError
from app.core.database import SessionLocal
from app.repositories.monitoring_repository import MonitoringRepository
from app.repositories.participant_repository import ParticipantRepository
from app.services.websocket_manager import manager
from app.services.screen_review_manager import (
    ScreenReviewStatus,
    screen_review_manager,
)

logger = logging.getLogger(__name__)

# Screen review SDP/ICE size limits
_MAX_SDP_SIZE = 10_240  # 10 KB
_MAX_CANDIDATE_SIZE = 1024  # 1 KB

# Total incoming message size limit — oversized frames are ignored so the
# receive loop survives and the connection stays usable
_MAX_WS_MESSAGE_SIZE = 65_536  # 64 KB

# Authentication timeout in seconds — unauthenticated connections are closed
WS_AUTH_TIMEOUT_SECONDS = 10

router = APIRouter()


@router.websocket("/ws/monitoring-sessions/{monitoring_session_id}")
async def monitoring_session_ws(websocket: WebSocket, monitoring_session_id: int):
    """WebSocket endpoint for live monitoring events.

    Connection flow:
    1. Accept connection.
    2. Wait for auth message (with timeout).
    3. Validate token type == 'access' (instructor).
    4. Verify session ownership.
    5. Register connection in ConnectionManager.
    6. Forward events until disconnect.
    """
    await websocket.accept()

    authenticated = False
    instructor_id: int | None = None

    try:
        # --- Authentication phase ---
        try:
            auth_message = await asyncio.wait_for(
                websocket.receive_json(), timeout=WS_AUTH_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            await websocket.close(code=4401, reason="Authentication timeout")
            return

        if not isinstance(auth_message, dict) or auth_message.get("type") != "authenticate":
            await websocket.close(code=4401, reason="Expected authenticate message")
            return

        access_token = auth_message.get("access_token")
        if not access_token or not isinstance(access_token, str):
            await websocket.close(code=4401, reason="Missing access_token")
            return

        # Validate token — must be instructor access token
        try:
            payload = verify_access_token(access_token)
        except TokenError:
            await websocket.close(code=4401, reason="Invalid or expired token")
            return

        # Token type is already validated as 'access' by verify_access_token
        # This rejects participant tokens and refresh tokens
        instructor_id = int(payload["sub"])

        # Verify session ownership via DB
        try:
            db = SessionLocal()
            monitoring_repo = MonitoringRepository(db)
            session = monitoring_repo.get_session_by_id_and_instructor(
                monitoring_session_id, instructor_id
            )
            db.close()
        except Exception:
            await websocket.close(code=4401, reason="Database error")
            return

        if not session:
            await websocket.close(code=4404, reason="Session not found or not owned")
            return

        # Authentication successful
        await websocket.send_json({
            "type": "authenticated",
            "monitoring_session_id": monitoring_session_id,
        })

        # Register in ConnectionManager
        await manager.connect(monitoring_session_id, websocket)
        authenticated = True

        # --- Event forwarding phase ---
        # Keep connection open; handle pings, screen review signaling
        while True:
            try:
                data = await websocket.receive_text()

                if len(data) > _MAX_WS_MESSAGE_SIZE:
                    continue  # ignore oversized messages

                if data == "ping":
                    await websocket.send_text("pong")
                    continue

                # Try to parse as JSON for screen review messages
                try:
                    msg = json.loads(data)
                except (json.JSONDecodeError, ValueError):
                    continue

                if not isinstance(msg, dict):
                    continue

                msg_type = msg.get("type")
                await _handle_instructor_screen_review(
                    msg_type, msg, websocket, monitoring_session_id, instructor_id
                )

            except WebSocketDisconnect:
                break
            except Exception:
                break

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("WebSocket error: %s", exc)
    finally:
        if authenticated:
            await manager.disconnect(monitoring_session_id, websocket)
            # Clean up any screen reviews initiated from this connection
            cleaned = await screen_review_manager.cleanup_by_session(
                monitoring_session_id
            )
            for req in cleaned:
                try:
                    await screen_review_manager.send_to_participant(
                        req.participant_session_id,
                        {
                            "type": "screen_review_stopped",
                            "screen_review_id": req.screen_review_id,
                        },
                    )
                except Exception:
                    pass


async def _handle_instructor_screen_review(
    msg_type: str | None,
    msg: dict,
    websocket: WebSocket,
    monitoring_session_id: int,
    instructor_id: int,
) -> None:
    """Handle screen review signaling messages from the instructor."""

    if msg_type == "screen_review_request":
        participant_session_id = msg.get("participant_session_id")
        if not isinstance(participant_session_id, str) or not participant_session_id:
            return

        # Validate participant belongs to this session
        try:
            db = SessionLocal()
            repo = ParticipantRepository(db)
            participant = repo.get_participant_by_psid(participant_session_id)
            db.close()
        except Exception:
            await websocket.send_json({
                "type": "screen_review_status",
                "status": "error",
                "message": "Database error",
            })
            return

        if (
            participant is None
            or participant.monitoring_session_id != monitoring_session_id
        ):
            await websocket.send_json({
                "type": "screen_review_status",
                "status": "error",
                "message": "Participant not found in this session",
                "participant_session_id": participant_session_id,
            })
            return

        # Create request
        request = await screen_review_manager.create_request(
            monitoring_session_id=monitoring_session_id,
            participant_session_id=participant_session_id,
            instructor_id=instructor_id,
            instructor_ws=websocket,
        )

        if request is None:
            await websocket.send_json({
                "type": "screen_review_status",
                "status": "error",
                "message": "Another screen review is already active",
                "participant_session_id": participant_session_id,
            })
            return

        # Notify instructor that request is pending
        await websocket.send_json({
            "type": "screen_review_status",
            "screen_review_id": request.screen_review_id,
            "status": "requested",
            "participant_session_id": participant_session_id,
        })

        # Forward request to participant
        sent = await screen_review_manager.send_to_participant(
            participant_session_id,
            {
                "type": "screen_review_request",
                "screen_review_id": request.screen_review_id,
                "monitoring_session_id": monitoring_session_id,
            },
        )

        if not sent:
            # Participant not connected
            await screen_review_manager.update_status(
                request.screen_review_id, ScreenReviewStatus.FAILED
            )
            await websocket.send_json({
                "type": "screen_review_status",
                "screen_review_id": request.screen_review_id,
                "status": "failed",
                "message": "Participant not connected",
                "participant_session_id": participant_session_id,
            })

    elif msg_type == "screen_review_answer":
        review_id = msg.get("screen_review_id")
        sdp = msg.get("sdp")

        if (
            not isinstance(review_id, str)
            or not isinstance(sdp, str)
            or len(sdp) > _MAX_SDP_SIZE
        ):
            return

        request = await screen_review_manager.get_request(review_id)
        if request is None:
            return
        if (
            request.instructor_id != instructor_id
            or request.monitoring_session_id != monitoring_session_id
        ):
            return
        if request.status != ScreenReviewStatus.ACCEPTED:
            return

        # Relay answer to participant
        await screen_review_manager.send_to_participant(
            request.participant_session_id,
            {
                "type": "screen_review_answer",
                "screen_review_id": review_id,
                "sdp": sdp,
            },
        )

    elif msg_type == "screen_review_ice_candidate":
        review_id = msg.get("screen_review_id")
        candidate = msg.get("candidate")
        sdp_mid = msg.get("sdpMid")
        sdp_mline_index = msg.get("sdpMLineIndex")

        if (
            not isinstance(review_id, str)
            or not isinstance(candidate, str)
            or len(candidate) > _MAX_CANDIDATE_SIZE
        ):
            return

        request = await screen_review_manager.get_request(review_id)
        if request is None:
            return
        if (
            request.instructor_id != instructor_id
            or request.monitoring_session_id != monitoring_session_id
        ):
            return
        if request.status in {
            ScreenReviewStatus.DECLINED,
            ScreenReviewStatus.STOPPED,
            ScreenReviewStatus.EXPIRED,
            ScreenReviewStatus.FAILED,
        }:
            return

        # Relay ICE candidate to participant
        await screen_review_manager.send_to_participant(
            request.participant_session_id,
            {
                "type": "screen_review_ice_candidate",
                "screen_review_id": review_id,
                "candidate": candidate,
                "sdpMid": sdp_mid,
                "sdpMLineIndex": sdp_mline_index,
            },
        )

    elif msg_type == "screen_review_stop":
        review_id = msg.get("screen_review_id")
        if not isinstance(review_id, str):
            return

        request = await screen_review_manager.get_request(review_id)
        if request is None:
            return
        if (
            request.instructor_id != instructor_id
            or request.monitoring_session_id != monitoring_session_id
        ):
            return

        await screen_review_manager.update_status(
            review_id, ScreenReviewStatus.STOPPED
        )

        # Notify participant to stop
        await screen_review_manager.send_to_participant(
            request.participant_session_id,
            {
                "type": "screen_review_stopped",
                "screen_review_id": review_id,
            },
        )
