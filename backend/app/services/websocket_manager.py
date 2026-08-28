"""In-memory WebSocket connection manager for real-time event routing.

Architecture note:
    In-memory WebSocket routing is suitable for the current single-process MVP.
    Multi-instance deployment will require shared pub/sub later.
"""

import asyncio
import json
import logging
from collections import defaultdict

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages authenticated instructor WebSocket connections keyed by
    monitoring_session_id.

    Routing model:
        MonitoringEvent.monitoring_session_id
            -> ConnectionManager.broadcast_to_session(...)
            -> only that session's authenticated instructor clients

    Properties:
        - Multiple dashboard tabs for the same session can connect concurrently.
        - Disconnect cleanup is automatic.
        - One broken socket never breaks broadcast for others.
        - Connections for session A never receive session B events.
        - No global broadcast.
    """

    def __init__(self):
        # monitoring_session_id -> set of authenticated WebSocket connections
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, monitoring_session_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[monitoring_session_id].add(websocket)
            logger.debug(
                "WS connected: session=%s (total=%d)",
                monitoring_session_id,
                len(self._connections[monitoring_session_id]),
            )

    async def disconnect(self, monitoring_session_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[monitoring_session_id].discard(websocket)
            # Clean up empty sets to avoid memory leak
            if not self._connections[monitoring_session_id]:
                del self._connections[monitoring_session_id]
            logger.debug("WS disconnected: session=%s", monitoring_session_id)

    async def broadcast_to_session(
        self, monitoring_session_id: int, message: dict
    ) -> None:
        """Send a JSON message to all authenticated connections for the given session.

        One broken socket must not prevent delivery to others.
        """
        async with self._lock:
            targets = list(self._connections.get(monitoring_session_id, set()))

        if not targets:
            return

        payload = json.dumps(message)
        dead: list[WebSocket] = []

        for ws in targets:
            try:
                await ws.send_text(payload)
            except Exception:
                # Mark for removal — do not raise
                dead.append(ws)
                logger.debug("WS send failed, marking for cleanup")

        # Clean up dead connections
        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections[monitoring_session_id].discard(ws)
                if not self._connections[monitoring_session_id]:
                    self._connections.pop(monitoring_session_id, None)

    def session_count(self, monitoring_session_id: int) -> int:
        """Return the current number of active connections for a session."""
        return len(self._connections.get(monitoring_session_id, set()))


# Singleton instance used across the application
manager = ConnectionManager()
