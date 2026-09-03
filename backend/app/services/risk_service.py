"""Risk snapshot service — queries events and computes participant risk (Phase 9).

Query strategy:
  - For session-wide risk: one query fetches all participant sessions for the
    monitoring session, then one query fetches all events for those participants.
    Grouping is done in Python (avoids N+1 and works across DB engines).

  - For single-participant risk: one query fetches events for that participant.
"""

import json
import logging
from collections import defaultdict

from sqlalchemy.orm import Session

from app.models.monitoring_event import MonitoringEvent, SEVERITY_MAP
from app.models.monitoring_session import MonitoringSession
from app.models.participant_session import ParticipantSession
from app.repositories.monitoring_repository import MonitoringRepository
from app.services.risk_scoring import compute_snapshot, ParticipantRiskSnapshot

logger = logging.getLogger(__name__)


class RiskService:
    """Compute risk snapshots from persisted MonitoringEvent rows."""

    def __init__(self, db: Session):
        self.db = db

    def get_session_risk(
        self, monitoring_session_id: int, instructor_id: int
    ) -> list[dict]:
        """Return risk snapshots for all participants in a monitoring session.

        - Verifies instructor ownership.
        - Efficient: one participant query + one event query.
        - Sorted by risk_score DESC, then student_name ASC.
        """
        # Verify ownership
        monitoring_repo = MonitoringRepository(self.db)
        session = monitoring_repo.get_session_by_id_and_instructor(
            monitoring_session_id, instructor_id
        )
        if not session:
            raise ValueError("Monitoring session not found")

        # Fetch all participants for this session
        participants = (
            self.db.query(ParticipantSession)
            .filter(ParticipantSession.monitoring_session_id == monitoring_session_id)
            .all()
        )

        if not participants:
            return []

        # Fetch ALL events for this monitoring session in one query
        events = (
            self.db.query(MonitoringEvent)
            .filter(MonitoringEvent.monitoring_session_id == monitoring_session_id)
            .order_by(MonitoringEvent.received_at.desc())
            .all()
        )

        # Group events by participant_session_id
        events_by_participant: dict[int, list[MonitoringEvent]] = defaultdict(list)
        for event in events:
            events_by_participant[event.participant_session_id].append(event)

        # Compute snapshot per participant
        snapshots: list[ParticipantRiskSnapshot] = []
        for ps in participants:
            participant_events = events_by_participant.get(ps.id, [])

            # Convert to dicts for compute_snapshot
            event_dicts = [
                {
                    "event_type": e.event_type.value,
                    "severity": e.severity.value,
                    "received_at": e.received_at,
                }
                for e in participant_events
            ]

            snapshot = compute_snapshot(
                participant_session_id=ps.participant_session_id,
                student_id=ps.student_id,
                student_name=ps.student_name,
                events=event_dicts,
            )
            snapshots.append(snapshot)

        # Sort: risk_score DESC, student_name ASC
        snapshots.sort(key=lambda s: (-s.risk_score, s.student_name))

        return [s.to_dict() for s in snapshots]

    def get_participant_risk(
        self,
        monitoring_session_id: int,
        participant_session_id: str,
        instructor_id: int,
    ) -> dict:
        """Return a single participant's risk snapshot."""
        # Verify ownership
        monitoring_repo = MonitoringRepository(self.db)
        session = monitoring_repo.get_session_by_id_and_instructor(
            monitoring_session_id, instructor_id
        )
        if not session:
            raise ValueError("Monitoring session not found")

        # Find participant
        ps = (
            self.db.query(ParticipantSession)
            .filter(
                ParticipantSession.monitoring_session_id == monitoring_session_id,
                ParticipantSession.participant_session_id == participant_session_id,
            )
            .first()
        )
        if not ps:
            raise ValueError("Participant not found")

        # Fetch events
        events = (
            self.db.query(MonitoringEvent)
            .filter(MonitoringEvent.participant_session_id == ps.id)
            .order_by(MonitoringEvent.received_at.desc())
            .all()
        )

        event_dicts = [
            {
                "event_type": e.event_type.value,
                "severity": e.severity.value,
                "received_at": e.received_at,
            }
            for e in events
        ]

        snapshot = compute_snapshot(
            participant_session_id=ps.participant_session_id,
            student_id=ps.student_id,
            student_name=ps.student_name,
            events=event_dicts,
        )

        return snapshot.to_dict()


def compute_participant_risk_for_broadcast(
    db: Session, participant_session_internal_id: int
) -> dict | None:
    """Compute a compact risk summary for WebSocket broadcast.

    Called after event commit to send participant_risk_updated.
    Returns None if the participant cannot be found (shouldn't happen).
    """
    ps = (
        db.query(ParticipantSession)
        .filter(ParticipantSession.id == participant_session_internal_id)
        .first()
    )
    if not ps:
        return None

    events = (
        db.query(MonitoringEvent)
        .filter(MonitoringEvent.participant_session_id == ps.id)
        .order_by(MonitoringEvent.received_at.desc())
        .all()
    )

    event_dicts = [
        {
            "event_type": e.event_type.value,
            "severity": e.severity.value,
            "received_at": e.received_at,
        }
        for e in events
    ]

    snapshot = compute_snapshot(
        participant_session_id=ps.participant_session_id,
        student_id=ps.student_id,
        student_name=ps.student_name,
        events=event_dicts,
    )

    return {
        "type": "participant_risk_updated",
        "participant_session_id": ps.participant_session_id,
        "risk_score": snapshot.risk_score,
        "risk_level": snapshot.risk_level,
        "total_events": snapshot.total_events,
    }
