from sqlalchemy.orm import Session

from app.models.monitoring_session import (
    MonitoringSession,
    StudentRosterEntry,
    JoinMode,
    SessionStatus,
)


class MonitoringRepository:
    """Database access layer for monitoring session operations."""

    def __init__(self, db: Session):
        self.db = db

    # --- Monitoring Sessions ---

    def get_session_by_id(self, session_id: int) -> MonitoringSession | None:
        return (
            self.db.query(MonitoringSession)
            .filter(MonitoringSession.id == session_id)
            .first()
        )

    def get_session_by_id_and_instructor(
        self, session_id: int, instructor_id: int
    ) -> MonitoringSession | None:
        return (
            self.db.query(MonitoringSession)
            .filter(
                MonitoringSession.id == session_id,
                MonitoringSession.instructor_id == instructor_id,
            )
            .first()
        )

    def get_sessions_by_instructor(self, instructor_id: int) -> list[MonitoringSession]:
        return (
            self.db.query(MonitoringSession)
            .filter(MonitoringSession.instructor_id == instructor_id)
            .order_by(MonitoringSession.created_at.desc())
            .all()
        )

    def exam_code_exists(self, exam_code: str) -> bool:
        return (
            self.db.query(MonitoringSession)
            .filter(MonitoringSession.exam_code == exam_code)
            .first()
            is not None
        )

    def create_session(
        self,
        exam_code: str,
        title: str,
        course_name: str | None,
        instructor_id: int,
        join_mode: JoinMode,
        starts_at=None,
        ends_at=None,
    ) -> MonitoringSession:
        session = MonitoringSession(
            exam_code=exam_code,
            title=title,
            course_name=course_name,
            instructor_id=instructor_id,
            join_mode=join_mode,
            status=SessionStatus.DRAFT,
            starts_at=starts_at,
            ends_at=ends_at,
        )
        self.db.add(session)
        self.db.flush()
        return session

    def update_session(self, session: MonitoringSession, **kwargs) -> MonitoringSession:
        for key, value in kwargs.items():
            if value is not None:
                setattr(session, key, value)
        self.db.flush()
        return session

    def delete_session(self, session: MonitoringSession) -> None:
        self.db.delete(session)
        self.db.flush()

    # --- Roster ---

    def get_roster_entries(self, session_id: int) -> list[StudentRosterEntry]:
        return (
            self.db.query(StudentRosterEntry)
            .filter(StudentRosterEntry.monitoring_session_id == session_id)
            .order_by(StudentRosterEntry.student_id)
            .all()
        )

    def get_roster_entry_by_id(self, entry_id: int) -> StudentRosterEntry | None:
        return (
            self.db.query(StudentRosterEntry)
            .filter(StudentRosterEntry.id == entry_id)
            .first()
        )

    def roster_entry_exists(self, session_id: int, student_id: str) -> bool:
        return (
            self.db.query(StudentRosterEntry)
            .filter(
                StudentRosterEntry.monitoring_session_id == session_id,
                StudentRosterEntry.student_id == student_id,
            )
            .first()
            is not None
        )

    def add_roster_entry(
        self, session_id: int, student_id: str, student_name: str
    ) -> StudentRosterEntry:
        entry = StudentRosterEntry(
            monitoring_session_id=session_id,
            student_id=student_id.strip(),
            student_name=student_name.strip(),
        )
        self.db.add(entry)
        self.db.flush()
        return entry

    def delete_roster_entry(self, entry: StudentRosterEntry) -> None:
        self.db.delete(entry)
        self.db.flush()

    def commit(self) -> None:
        self.db.commit()

    def rollback(self) -> None:
        self.db.rollback()
