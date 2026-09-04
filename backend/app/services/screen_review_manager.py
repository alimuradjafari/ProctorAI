"""In-memory screen review request manager.

Manages transient screen-review state for on-demand live screen sharing.
No database persistence — all state is lost on process restart.

Architecture note:
    Single-process in-memory state is suitable for the current MVP.
    Multi-instance deployment will require shared state (e.g. Redis pub/sub).
"""

import asyncio
import logging
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

from fastapi import WebSocket

logger = logging.getLogger(__name__)

# Request timeout — if student doesn't respond within this window
SCREEN_REVIEW_REQUEST_TIMEOUT_SECONDS = 30


class ScreenReviewStatus(str, Enum):
    """Screen review request lifecycle states."""

    REQUESTED = "requested"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    SHARING = "sharing"
    STOPPED = "stopped"
    EXPIRED = "expired"
    FAILED = "failed"


# Valid status transitions
_VALID_TRANSITIONS: dict[ScreenReviewStatus, set[ScreenReviewStatus]] = {
    ScreenReviewStatus.REQUESTED: {
        ScreenReviewStatus.ACCEPTED,
        ScreenReviewStatus.DECLINED,
        ScreenReviewStatus.EXPIRED,
        ScreenReviewStatus.STOPPED,
    },
    ScreenReviewStatus.ACCEPTED: {
        ScreenReviewStatus.SHARING,
        ScreenReviewStatus.STOPPED,
        ScreenReviewStatus.FAILED,
    },
    ScreenReviewStatus.SHARING: {
        ScreenReviewStatus.STOPPED,
        ScreenReviewStatus.FAILED,
    },
    # Terminal states — no further transitions
    ScreenReviewStatus.DECLINED: set(),
    ScreenReviewStatus.STOPPED: set(),
    ScreenReviewStatus.EXPIRED: set(),
    ScreenReviewStatus.FAILED: set(),
}

# Terminal states that trigger cleanup
_TERMINAL_STATES = {
    ScreenReviewStatus.DECLINED,
    ScreenReviewStatus.STOPPED,
    ScreenReviewStatus.EXPIRED,
    ScreenReviewStatus.FAILED,
}


def _generate_review_id() -> str:
    """Generate an opaque screen review ID: SR-<32 hex chars>."""
    return f"SR-{secrets.token_hex(16)}"


@dataclass
class ScreenReviewRequest:
    """Transient in-memory screen review request."""

    screen_review_id: str
    monitoring_session_id: int
    participant_session_id: str
    instructor_id: int
    instructor_ws: WebSocket
    created_at: datetime
    status: ScreenReviewStatus
    timeout_task: asyncio.Task | None = field(default=None, repr=False)


class ScreenReviewManager:
    """Manages screen review request lifecycle and participant WS connections.

    Properties:
        - One active review per monitoring session at a time.
        - 30-second timeout for student response.
        - Participant WS connections tracked for signaling relay.
        - Cleanup is idempotent — safe to call multiple times.
    """

    def __init__(self):
        # screen_review_id -> request
        self._requests: dict[str, ScreenReviewRequest] = {}
        # monitoring_session_id -> active screen_review_id
        self._active_by_session: dict[int, str] = {}
        # participant_session_id -> WebSocket
        self._participant_ws: dict[str, WebSocket] = {}
        self._lock = asyncio.Lock()

    async def create_request(
        self,
        monitoring_session_id: int,
        participant_session_id: str,
        instructor_id: int,
        instructor_ws: WebSocket,
    ) -> ScreenReviewRequest | None:
        """Create a new screen review request.

        Returns None if an active review already exists for this session.
        """
        async with self._lock:
            # Enforce one active review per session
            existing_id = self._active_by_session.get(monitoring_session_id)
            if existing_id is not None:
                existing = self._requests.get(existing_id)
                if existing and existing.status not in _TERMINAL_STATES:
                    return None
                # Stale terminal entry — clean up
                self._active_by_session.pop(monitoring_session_id, None)

            review_id = _generate_review_id()
            now = datetime.now(timezone.utc)

            request = ScreenReviewRequest(
                screen_review_id=review_id,
                monitoring_session_id=monitoring_session_id,
                participant_session_id=participant_session_id,
                instructor_id=instructor_id,
                instructor_ws=instructor_ws,
                created_at=now,
                status=ScreenReviewStatus.REQUESTED,
            )

            self._requests[review_id] = request
            self._active_by_session[monitoring_session_id] = review_id

            # Start timeout task
            request.timeout_task = asyncio.create_task(
                self._expire_after_timeout(review_id)
            )

            logger.info(
                "Screen review created: %s session=%s participant=%s",
                review_id,
                monitoring_session_id,
                participant_session_id,
            )
            return request

    async def get_request(
        self, screen_review_id: str
    ) -> ScreenReviewRequest | None:
        """Look up a screen review request by ID."""
        return self._requests.get(screen_review_id)

    async def update_status(
        self,
        screen_review_id: str,
        new_status: ScreenReviewStatus,
    ) -> bool:
        """Update the status of a screen review request.

        Returns True if the transition was valid and applied.
        """
        async with self._lock:
            request = self._requests.get(screen_review_id)
            if request is None:
                return False

            # Validate transition
            valid_next = _VALID_TRANSITIONS.get(request.status, set())
            if new_status not in valid_next:
                logger.warning(
                    "Invalid transition for %s: %s -> %s",
                    screen_review_id,
                    request.status.value,
                    new_status.value,
                )
                return False

            request.status = new_status

            # Cancel timeout on terminal state
            if new_status in _TERMINAL_STATES:
                self._cancel_timeout(request)
                # Remove from active index
                active_id = self._active_by_session.get(
                    request.monitoring_session_id
                )
                if active_id == screen_review_id:
                    self._active_by_session.pop(
                        request.monitoring_session_id, None
                    )

            logger.info(
                "Screen review %s: %s -> %s",
                screen_review_id,
                request.status.value,
                new_status.value,
            )
            return True

    async def get_active_for_session(
        self, monitoring_session_id: int
    ) -> ScreenReviewRequest | None:
        """Return the active (non-terminal) request for a session, if any."""
        review_id = self._active_by_session.get(monitoring_session_id)
        if review_id is None:
            return None
        request = self._requests.get(review_id)
        if request and request.status not in _TERMINAL_STATES:
            return request
        return None

    async def cleanup_by_session(
        self, monitoring_session_id: int
    ) -> list[ScreenReviewRequest]:
        """Stop all reviews for a session. Returns list of affected requests."""
        cleaned: list[ScreenReviewRequest] = []
        async with self._lock:
            review_id = self._active_by_session.pop(
                monitoring_session_id, None
            )
            if review_id:
                request = self._requests.get(review_id)
                if request and request.status not in _TERMINAL_STATES:
                    request.status = ScreenReviewStatus.STOPPED
                    self._cancel_timeout(request)
                    cleaned.append(request)
        return cleaned

    async def cleanup_by_participant(
        self, participant_session_id: str
    ) -> list[ScreenReviewRequest]:
        """Stop all reviews for a participant. Returns list of affected requests."""
        cleaned: list[ScreenReviewRequest] = []
        async with self._lock:
            for request in self._requests.values():
                if (
                    request.participant_session_id == participant_session_id
                    and request.status not in _TERMINAL_STATES
                ):
                    request.status = ScreenReviewStatus.STOPPED
                    self._cancel_timeout(request)
                    # Remove from active index
                    active_id = self._active_by_session.get(
                        request.monitoring_session_id
                    )
                    if active_id == request.screen_review_id:
                        self._active_by_session.pop(
                            request.monitoring_session_id, None
                        )
                    cleaned.append(request)
        return cleaned

    # --- Participant WebSocket management ---

    async def register_participant_ws(
        self, participant_session_id: str, ws: WebSocket
    ) -> None:
        """Register a participant's WebSocket connection for signaling."""
        async with self._lock:
            self._participant_ws[participant_session_id] = ws
            logger.debug(
                "Participant WS registered: %s", participant_session_id
            )

    async def unregister_participant_ws(
        self, participant_session_id: str
    ) -> None:
        """Remove a participant's WebSocket connection."""
        async with self._lock:
            self._participant_ws.pop(participant_session_id, None)
            logger.debug(
                "Participant WS unregistered: %s", participant_session_id
            )

    async def send_to_participant(
        self, participant_session_id: str, message: dict
    ) -> bool:
        """Send a JSON message to a participant's WebSocket.

        Returns True if sent successfully, False otherwise.
        """
        ws = self._participant_ws.get(participant_session_id)
        if ws is None:
            return False
        try:
            await ws.send_json(message)
            return True
        except Exception:
            logger.debug(
                "Failed to send to participant %s", participant_session_id
            )
            return False

    async def send_to_instructor(
        self, request: ScreenReviewRequest, message: dict
    ) -> bool:
        """Send a JSON message to the instructor's WebSocket for this review.

        Returns True if sent successfully, False otherwise.
        """
        try:
            await request.instructor_ws.send_json(message)
            return True
        except Exception:
            logger.debug(
                "Failed to send to instructor for review %s",
                request.screen_review_id,
            )
            return False

    # --- Internal helpers ---

    def _cancel_timeout(self, request: ScreenReviewRequest) -> None:
        """Cancel the timeout task for a request (non-blocking)."""
        if request.timeout_task and not request.timeout_task.done():
            request.timeout_task.cancel()
        request.timeout_task = None

    async def _expire_after_timeout(
        self, screen_review_id: str
    ) -> None:
        """Timeout callback — expire the request if still pending."""
        try:
            await asyncio.sleep(SCREEN_REVIEW_REQUEST_TIMEOUT_SECONDS)
        except asyncio.CancelledError:
            return  # Request was resolved before timeout

        async with self._lock:
            request = self._requests.get(screen_review_id)
            if (
                request
                and request.status == ScreenReviewStatus.REQUESTED
            ):
                request.status = ScreenReviewStatus.EXPIRED
                request.timeout_task = None
                # Remove from active index
                active_id = self._active_by_session.get(
                    request.monitoring_session_id
                )
                if active_id == screen_review_id:
                    self._active_by_session.pop(
                        request.monitoring_session_id, None
                    )
                logger.info(
                    "Screen review %s expired (timeout)", screen_review_id
                )
                # Notify instructor — done outside lock
                try:
                    await request.instructor_ws.send_json({
                        "type": "screen_review_status",
                        "screen_review_id": screen_review_id,
                        "status": "expired",
                        "participant_session_id": (
                            request.participant_session_id
                        ),
                    })
                except Exception:
                    pass  # Instructor may have disconnected


# Singleton instance used across the application
screen_review_manager = ScreenReviewManager()
