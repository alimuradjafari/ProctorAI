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
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.security import verify_access_token, TokenError
from app.core.database import SessionLocal
from app.repositories.monitoring_repository import MonitoringRepository
from app.services.websocket_manager import manager

logger = logging.getLogger(__name__)

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
        # Keep connection open; just handle pings/disconnects
        while True:
            try:
                # Receive client messages (pings, keep-alives, etc.)
                data = await websocket.receive_text()
                # Optionally respond to ping messages
                if data == "ping":
                    await websocket.send_text("pong")
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
