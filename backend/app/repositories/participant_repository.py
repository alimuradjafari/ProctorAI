from sqlalchemy.orm import Session

from app.models.monitoring_session import MonitoringSession, StudentRosterEntry
from app.models.participant_session import (
    ParticipantSession,
    ParticipantStatus,
    generate_participant_session_id,
)


class ParticipantRepository:
    """Database access layer for participant session operations."""

    def __init__(self, db: Session):
        self.db = db

    # --- Monitoring Session Lookup ---

    def get_session_by_exam_code(self, exam_code: str) -> MonitoringSession | None:
        return (
            self.db.query(MonitoringSession)
            .filter(MonitoringSession.exam_code == exam_code)
            .first()
        )

    # --- Roster Lookup ---

    def get_roster_entry(
        self, session_id: int, student_id: str
    ) -> StudentRosterEntry | None:
        return (
            self.db.query(StudentRosterEntry)
            .filter(
                StudentRosterEntry.monitoring_session_id == session_id,
                StudentRosterEntry.student_id == student_id,
            )
            .first()
        )

    # --- Participant Sessions ---

    def get_participant_by_session_and_student(
        self, monitoring_session_id: int, student_id: str
    ) -> ParticipantSession | None:
        return (
            self.db.query(ParticipantSession)
            .filter(
                ParticipantSession.monitoring_session_id == monitoring_session_id,
                ParticipantSession.student_id == student_id,
            )
            .first()
        )

    def get_participant_by_psid(
        self, participant_session_id: str
    ) -> ParticipantSession | None:
        return (
            self.db.query(ParticipantSession)
            .filter(
                ParticipantSession.participant_session_id == participant_session_id
            )
            .first()
        )

    def get_participants_by_session(
        self, monitoring_session_id: int
    ) -> list[ParticipantSession]:
        return (
            self.db.query(ParticipantSession)
            .filter(
                ParticipantSession.monitoring_session_id == monitoring_session_id
            )
            .order_by(ParticipantSession.joined_at)
            .all()
        )

    def psid_exists(self, psid: str) -> bool:
        return self.get_participant_by_psid(psid) is not None

    def create_participant(
        self,
        monitoring_session_id: int,
        student_id: str,
        student_name: str,
        roster_entry_id: int | None = None,
    ) -> ParticipantSession:
        # Generate unique participant_session_id
        for _ in range(10):
            psid = generate_participant_session_id()
            if not self.psid_exists(psid):
                break
        else:
            raise RuntimeError("Failed to generate unique participant session ID")

        participant = ParticipantSession(
            participant_session_id=psid,
            monitoring_session_id=monitoring_session_id,
            roster_entry_id=roster_entry_id,
            student_id=student_id,
            student_name=student_name,
            status=ParticipantStatus.JOINED,
        )
        self.db.add(participant)
        self.db.flush()
        return participant

    def commit(self) -> None:
        self.db.commit()

    def rollback(self) -> None:
        self.db.rollback()
