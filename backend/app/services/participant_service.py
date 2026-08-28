import re

from sqlalchemy.orm import Session

from app.models.monitoring_session import JoinMode, SessionStatus
from app.models.participant_session import ParticipantSession
from app.repositories.participant_repository import ParticipantRepository
from app.core.security import create_participant_token, verify_participant_token, TokenError


def _normalize_name(name: str) -> str:
    """Normalize a name for comparison: trim, collapse whitespace, lowercase."""
    return re.sub(r'\s+', ' ', name.strip()).lower()


def _normalize_student_id(student_id: str) -> str:
    """Normalize a student ID for comparison: trim, lowercase."""
    return student_id.strip().lower()


class ParticipantService:
    """Business logic for participant sessions."""

    def __init__(self, db: Session):
        self.repo = ParticipantRepository(db)

    def join(
        self, exam_code: str, student_id: str, student_name: str
    ) -> dict:
        """Process a student join request. Returns join response data."""
        # 1. Normalize inputs
        exam_code = exam_code.strip().upper()
        student_id_normalized = student_id.strip()
        student_name = student_name.strip()

        if not student_id_normalized:
            raise ValueError("Student ID is required")
        if not student_name:
            raise ValueError("Student name is required")

        # 2. Look up monitoring session by exam code
        session = self.repo.get_session_by_exam_code(exam_code)
        if not session:
            raise ValueError("Invalid exam code")

        # 3. Check session status
        if session.status not in (SessionStatus.WAITING, SessionStatus.LIVE):
            raise ValueError("This exam session is not currently accepting participants")

        # 4. Apply join-mode validation
        roster_entry_id = None
        if session.join_mode == JoinMode.ROSTER_REQUIRED:
            roster_entry = self.repo.get_roster_entry(
                session.id, _normalize_student_id(student_id_normalized)
            )
            # Also try original case if normalized didn't match
            if not roster_entry:
                roster_entry = self.repo.get_roster_entry(
                    session.id, student_id_normalized
                )
            if not roster_entry:
                raise PermissionError("Unable to join with the provided student details.")

            # Verify name matches
            if _normalize_name(roster_entry.student_name) != _normalize_name(student_name):
                raise PermissionError("Unable to join with the provided student details.")

            roster_entry_id = roster_entry.id

        # 5. Check for existing participant (reconnect/reload)
        # Use normalized student_id for uniqueness check
        existing = self.repo.get_participant_by_session_and_student(
            session.id, _normalize_student_id(student_id_normalized)
        )
        if not existing:
            # Also try original case
            existing = self.repo.get_participant_by_session_and_student(
                session.id, student_id_normalized
            )

        if existing:
            if _normalize_name(existing.student_name) != _normalize_name(student_name):
                raise PermissionError(
                    "Unable to join with the provided student details."
                )

            participant = existing
        else:
            # Create new participant
            try:
                participant = self.repo.create_participant(
                    monitoring_session_id=session.id,
                    student_id=_normalize_student_id(student_id_normalized),
                    student_name=student_name,
                    roster_entry_id=roster_entry_id,
                )
                self.repo.commit()
            except Exception:
                self.repo.rollback()
                raise

        # 6. Issue participant token
        token = create_participant_token(participant.participant_session_id)

        return {
            "participant_session_id": participant.participant_session_id,
            "participant_access_token": token,
            "token_type": "bearer",
            "participant": {
                "student_id": participant.student_id,
                "student_name": participant.student_name,
                "status": participant.status.value,
                "joined_at": participant.joined_at,
            },
            "monitoring_session": {
                "exam_code": session.exam_code,
                "title": session.title,
                "course_name": session.course_name,
                "status": session.status.value,
                "join_mode": session.join_mode.value,
            },
        }

    def get_participant_me(self, participant_token: str) -> dict:
        """Restore participant session state from token."""
        try:
            payload = verify_participant_token(participant_token)
        except TokenError:
            raise ValueError("Invalid or expired participant token")

        psid = payload["sub"]
        participant = self.repo.get_participant_by_psid(psid)
        if not participant:
            raise ValueError("Participant session not found")

        # Resolve monitoring session via relationship
        ms = participant.monitoring_session

        return {
            "participant_session_id": participant.participant_session_id,
            "student_id": participant.student_id,
            "student_name": participant.student_name,
            "status": participant.status.value,
            "joined_at": participant.joined_at,
            "exam_code": ms.exam_code,
            "title": ms.title,
            "course_name": ms.course_name,
            "session_status": ms.status.value,
        }

    def list_participants(
        self, monitoring_session_id: int, instructor_id: int
    ) -> list:
        """List participants for an instructor-owned monitoring session."""
        # Verify ownership via monitoring repository
        from app.repositories.monitoring_repository import MonitoringRepository
        monitoring_repo = MonitoringRepository(self.repo.db)
        session = monitoring_repo.get_session_by_id_and_instructor(
            monitoring_session_id, instructor_id
        )
        if not session:
            raise ValueError("Monitoring session not found")

        participants = self.repo.get_participants_by_session(monitoring_session_id)
        return [
            {
                "participant_session_id": p.participant_session_id,
                "student_id": p.student_id,
                "student_name": p.student_name,
                "status": p.status.value,
                "joined_at": p.joined_at,
                "last_seen_at": p.last_seen_at,
            }
            for p in participants
        ]
