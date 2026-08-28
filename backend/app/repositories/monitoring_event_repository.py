"""Database access layer for monitoring event operations."""

import json
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.monitoring_event import (
    MonitoringEvent,
    EventType,
    EventSeverity,
    SEVERITY_MAP,
    generate_event_id,
)
from app.models.participant_session import ParticipantSession


class MonitoringEventRepository:
    """Repository for monitoring event persistence and retrieval."""

    def __init__(self, db: Session):
        self.db = db

    # --- Participant Session Lookup ---

    def get_participant_by_psid(self, psid: str) -> ParticipantSession | None:
        return (
            self.db.query(ParticipantSession)
            .filter(ParticipantSession.participant_session_id == psid)
            .first()
        )

    # --- Idempotency ---

    def get_event_by_client_id(
        self, participant_session_id: int, client_event_id: str
    ) -> MonitoringEvent | None:
        """Return existing event for transport-level idempotency."""
        return (
            self.db.query(MonitoringEvent)
            .filter(
                MonitoringEvent.participant_session_id == participant_session_id,
                MonitoringEvent.client_event_id == client_event_id,
            )
            .first()
        )

    # --- Event Creation ---

    def event_id_exists(self, event_id: str) -> bool:
        return (
            self.db.query(MonitoringEvent)
            .filter(MonitoringEvent.event_id == event_id)
            .first()
            is not None
        )

    def create_event(
        self,
        participant_session_id: int,
        monitoring_session_id: int,
        event_type: EventType,
        severity: EventSeverity,
        confidence: float | None,
        client_event_id: str | None,
        client_occurred_at,
        metadata: dict | None,
    ) -> MonitoringEvent:
        """Persist a new monitoring event with server-generated event_id and severity."""
        # Generate unique event_id
        for _ in range(10):
            eid = generate_event_id()
            if not self.event_id_exists(eid):
                break
        else:
            raise RuntimeError("Failed to generate unique event ID")

        severity = SEVERITY_MAP[event_type]

        # Use Python-side timestamp for reliable ordering across DB engines
        now = datetime.now(timezone.utc)

        event = MonitoringEvent(
            event_id=eid,
            participant_session_id=participant_session_id,
            monitoring_session_id=monitoring_session_id,
            event_type=event_type,
            severity=severity,
            confidence=confidence,
            client_event_id=client_event_id,
            client_occurred_at=client_occurred_at,
            metadata_json=json.dumps(metadata or {}),
            received_at=now,
        )
        self.db.add(event)
        self.db.flush()
        return event

    # --- Event History ---

    def get_events_by_session(
        self, monitoring_session_id: int, limit: int = 100
    ) -> list[MonitoringEvent]:
        """Return events for a monitoring session, newest first."""
        return (
            self.db.query(MonitoringEvent)
            .filter(MonitoringEvent.monitoring_session_id == monitoring_session_id)
            .order_by(MonitoringEvent.received_at.desc())
            .limit(limit)
            .all()
        )

    def commit(self) -> None:
        self.db.commit()

    def rollback(self) -> None:
        self.db.rollback()
