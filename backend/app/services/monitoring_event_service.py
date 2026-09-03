"""Business logic for monitoring event submission and routing."""

import json
import logging

from sqlalchemy.orm import Session

from app.models.monitoring_session import SessionStatus
from app.models.monitoring_event import MonitoringEvent, EventType, SEVERITY_MAP
from app.repositories.monitoring_event_repository import MonitoringEventRepository
from app.schemas.monitoring_event import EventResponse, EventParticipantResponse
from app.services.websocket_manager import manager as ws_manager
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)


def _event_to_response(
    event: MonitoringEvent,
    participant_session_id_str: str,
    student_id: str,
    student_name: str,
) -> dict:
    """Convert a MonitoringEvent row to a response dict."""
    return {
        "event_id": event.event_id,
        "event_type": event.event_type.value,
        "severity": event.severity.value,
        "confidence": event.confidence,
        "client_event_id": event.client_event_id,
        "metadata": json.loads(event.metadata_json) if event.metadata_json else {},
        "received_at": event.received_at,
        "participant": {
            "participant_session_id": participant_session_id_str,
            "student_id": student_id,
            "student_name": student_name,
        },
    }


def _event_to_broadcast(event: MonitoringEvent, participant_info: dict) -> dict:
    """Build a WebSocket broadcast message for an event."""
    return {
        "type": "monitoring_event",
        "event": {
            "event_id": event.event_id,
            "event_type": event.event_type.value,
            "severity": event.severity.value,
            "confidence": event.confidence,
            "metadata": json.loads(event.metadata_json) if event.metadata_json else {},
            "received_at": event.received_at.isoformat() if event.received_at else None,
            "participant_session_id": participant_info["participant_session_id"],
            "student_id": participant_info["student_id"],
            "student_name": participant_info["student_name"],
        },
    }


class MonitoringEventService:
    """Handles monitoring event submission, persistence, and instructor delivery."""

    def __init__(self, db: Session):
        self.repo = MonitoringEventRepository(db)
        self.db = db

    def submit_event(
        self,
        participant_token_psid: str,
        event_type: EventType,
        confidence: float | None,
        client_event_id: str | None,
        client_occurred_at,
        metadata: dict | None,
    ) -> dict:
        """Submit a monitoring event.

        Server-authoritative routing:
            participant_token -> ParticipantSession -> MonitoringSession -> Instructor

        Returns response dict and schedules async broadcast after commit.
        """
        # 1. Resolve ParticipantSession from token
        participant = self.repo.get_participant_by_psid(participant_token_psid)
        if not participant:
            raise ValueError("Participant session not found")

        # 2. Resolve MonitoringSession from relationship
        monitoring_session = participant.monitoring_session
        if not monitoring_session:
            raise ValueError("Monitoring session not found")

        # 3. Require LIVE status
        if monitoring_session.status != SessionStatus.LIVE:
            raise ValueError(
                f"Events can only be submitted to LIVE sessions (current: {monitoring_session.status.value})"
            )

        # Server-owned severity
        severity = SEVERITY_MAP[event_type]
    
        # 4. Check transport idempotency
        if client_event_id is not None:
            existing = self.repo.get_event_by_client_id(
                participant.id, client_event_id
            )
            if existing:
                # Return existing event — do not broadcast again
                return {
                    "event": _event_to_response(
                        existing,
                        participant.participant_session_id,
                        participant.student_id,
                        participant.student_name,
                    ),
                    "is_duplicate": True,
                    "monitoring_session_id": monitoring_session.id,
                }

        # 5. Persist new event (server populates monitoring_session_id + severity)
        try:
            event = self.repo.create_event(
                participant_session_id=participant.id,
                monitoring_session_id=participant.monitoring_session_id,
                event_type=event_type,
                severity=severity,
                confidence=confidence,
                client_event_id=client_event_id,
                client_occurred_at=client_occurred_at,
                metadata=metadata,
            )
            self.repo.commit()

        except IntegrityError:
            self.repo.rollback()

            # Concurrent retry may have inserted the same idempotency key
            if client_event_id is not None:
                existing = self.repo.get_event_by_client_id(
                    participant.id,
                    client_event_id,
                )

                if existing:
                    return {
                        "event": _event_to_response(
                            existing,
                            participant.participant_session_id,
                            participant.student_id,
                            participant.student_name,
                        ),
                        "is_duplicate": True,
                    }

            # Some other integrity constraint failed
            raise

        except Exception:
            self.repo.rollback()
            raise

        response_data = _event_to_response(
            event,
            participant.participant_session_id,
            participant.student_id,
            participant.student_name,
        )

        return {
            "event": response_data,
            "is_duplicate": False,
            "monitoring_session_id": monitoring_session.id,
            "_participant_internal_id": participant.id,
        }

    def list_events(
        self, monitoring_session_id: int, instructor_id: int, limit: int = 100
    ) -> list[dict]:
        """Return recent events for an instructor-owned session."""
        # Verify ownership
        from app.repositories.monitoring_repository import MonitoringRepository

        monitoring_repo = MonitoringRepository(self.db)
        session = monitoring_repo.get_session_by_id_and_instructor(
            monitoring_session_id, instructor_id
        )
        if not session:
            raise ValueError("Monitoring session not found")

        events = self.repo.get_events_by_session(monitoring_session_id, limit=limit)

        # Pre-load participant sessions for efficiency
        from app.models.participant_session import ParticipantSession

        result = []
        for event in events:
            ps = (
                self.db.query(ParticipantSession)
                .filter(ParticipantSession.id == event.participant_session_id)
                .first()
            )
            if ps:
                result.append(
                    _event_to_response(
                        event,
                        ps.participant_session_id,
                        ps.student_id,
                        ps.student_name,
                    )
                )
        return result


async def broadcast_event(result: dict) -> None:
    """Broadcast a committed event and the participant's updated risk snapshot.

    Call ONLY after successful commit — never broadcast uncommitted events.
    """
    if result.get("is_duplicate"):
        return  # Do not rebroadcast duplicates

    event_data = result["event"]
    monitoring_session_id = result["monitoring_session_id"]

    # 1. Broadcast the monitoring event (existing behavior)
    event_message = {
        "type": "monitoring_event",
        "event": {
            "event_id": event_data["event_id"],
            "event_type": event_data["event_type"],
            "severity": event_data["severity"],
            "confidence": event_data["confidence"],
            "metadata": event_data["metadata"],
            "received_at": (
                event_data["received_at"].isoformat()
                if hasattr(event_data["received_at"], "isoformat")
                else event_data["received_at"]
            ),
            "participant_session_id": event_data["participant"]["participant_session_id"],
            "student_id": event_data["participant"]["student_id"],
            "student_name": event_data["participant"]["student_name"],
        },
    }

    await ws_manager.broadcast_to_session(monitoring_session_id, event_message)

    # 2. Broadcast participant risk update (Phase 9)
    participant_internal_id = result.get("_participant_internal_id")
    if participant_internal_id is not None:
        try:
            from app.services.risk_service import compute_participant_risk_for_broadcast
            from app.core.database import SessionLocal

            db = SessionLocal()
            try:
                risk_payload = compute_participant_risk_for_broadcast(
                    db, participant_internal_id
                )
                if risk_payload:
                    await ws_manager.broadcast_to_session(
                        monitoring_session_id, risk_payload
                    )
            finally:
                db.close()
        except Exception:
            # Risk broadcast failure must not break event delivery
            import logging
            logging.getLogger(__name__).debug(
                "Risk broadcast failed (non-critical)", exc_info=True
            )
