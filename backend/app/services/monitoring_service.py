import csv
import io

from sqlalchemy.orm import Session

from app.models.monitoring_session import (
    MonitoringSession,
    JoinMode,
    SessionStatus,
    VALID_TRANSITIONS,
    generate_exam_code,
)
from app.repositories.monitoring_repository import MonitoringRepository


class MonitoringService:
    """Business logic for monitoring sessions and roster."""

    def __init__(self, db: Session):
        self.repo = MonitoringRepository(db)

    # --- Helpers ---

    def _get_owned_session(self, session_id: int, instructor_id: int) -> MonitoringSession:
        """Get a session ensuring it belongs to the authenticated instructor."""
        session = self.repo.get_session_by_id_and_instructor(session_id, instructor_id)
        if not session:
            raise ValueError("Monitoring session not found")
        return session

    def _generate_unique_exam_code(self, prefix_source: str) -> str:
        """Generate a unique exam code, retrying on collision."""
        for _ in range(10):
            code = generate_exam_code(prefix_source)
            if not self.repo.exam_code_exists(code):
                return code
        raise RuntimeError("Failed to generate unique exam code after multiple attempts")

    # --- Session CRUD ---

    def create_session(
        self,
        instructor_id: int,
        title: str,
        course_name: str | None,
        join_mode: str,
        starts_at=None,
        ends_at=None,
    ) -> MonitoringSession:
        # Validate join_mode
        try:
            join_mode_enum = JoinMode(join_mode)
        except ValueError:
            raise ValueError(f"Invalid join mode: {join_mode}. Must be 'open_join' or 'roster_required'")

        # Generate unique exam code
        prefix_source = f"{course_name or ''} {title}".strip()
        exam_code = self._generate_unique_exam_code(prefix_source)

        try:
            session = self.repo.create_session(
                exam_code=exam_code,
                title=title,
                course_name=course_name,
                instructor_id=instructor_id,
                join_mode=join_mode_enum,
                starts_at=starts_at,
                ends_at=ends_at,
            )
            self.repo.commit()
            return session
        except Exception:
            self.repo.rollback()
            raise

    def list_sessions(self, instructor_id: int) -> list[MonitoringSession]:
        return self.repo.get_sessions_by_instructor(instructor_id)

    def get_session(self, session_id: int, instructor_id: int) -> MonitoringSession:
        return self._get_owned_session(session_id, instructor_id)

    def update_session(
        self, session_id: int, instructor_id: int, **kwargs
    ) -> MonitoringSession:
        session = self._get_owned_session(session_id, instructor_id)

        # Only allow updates on DRAFT sessions
        if session.status != SessionStatus.DRAFT:
            raise ValueError("Only DRAFT sessions can be edited")

        # Validate join_mode if provided
        if "join_mode" in kwargs and kwargs["join_mode"] is not None:
            try:
                kwargs["join_mode"] = JoinMode(kwargs["join_mode"])
            except ValueError:
                raise ValueError("Invalid join mode")

        try:
            # Filter out None values
            updates = {k: v for k, v in kwargs.items() if v is not None}
            session = self.repo.update_session(session, **updates)
            self.repo.commit()
            return session
        except Exception:
            self.repo.rollback()
            raise

    def delete_session(self, session_id: int, instructor_id: int) -> None:
        session = self._get_owned_session(session_id, instructor_id)

        # Only allow deletion of DRAFT or CANCELLED sessions
        if session.status not in (SessionStatus.DRAFT, SessionStatus.CANCELLED):
            raise ValueError("Only DRAFT or CANCELLED sessions can be deleted")

        try:
            self.repo.delete_session(session)
            self.repo.commit()
        except Exception:
            self.repo.rollback()
            raise

    # --- Lifecycle ---

    def transition_session(
        self, session_id: int, instructor_id: int, target_status: SessionStatus
    ) -> MonitoringSession:
        session = self._get_owned_session(session_id, instructor_id)

        current = session.status
        valid_targets = VALID_TRANSITIONS.get(current, [])

        if target_status not in valid_targets:
            raise ValueError(
                f"Invalid transition from {current.value} to {target_status.value}. "
                f"Allowed: {[t.value for t in valid_targets]}"
            )

        try:
            session = self.repo.update_session(session, status=target_status)
            self.repo.commit()
            return session
        except Exception:
            self.repo.rollback()
            raise

    def prepare_session(self, session_id: int, instructor_id: int) -> MonitoringSession:
        """DRAFT -> WAITING"""
        return self.transition_session(session_id, instructor_id, SessionStatus.WAITING)

    def start_session(self, session_id: int, instructor_id: int) -> MonitoringSession:
        """WAITING -> LIVE"""
        return self.transition_session(session_id, instructor_id, SessionStatus.LIVE)

    def end_session(self, session_id: int, instructor_id: int) -> MonitoringSession:
        """LIVE -> ENDED"""
        return self.transition_session(session_id, instructor_id, SessionStatus.ENDED)

    def cancel_session(self, session_id: int, instructor_id: int) -> MonitoringSession:
        """DRAFT or WAITING -> CANCELLED"""
        return self.transition_session(session_id, instructor_id, SessionStatus.CANCELLED)

    # --- Roster ---

    def list_roster(self, session_id: int, instructor_id: int) -> list:
        self._get_owned_session(session_id, instructor_id)
        return self.repo.get_roster_entries(session_id)

    def add_roster_entry(
        self, session_id: int, instructor_id: int, student_id: str, student_name: str
    ):
        self._get_owned_session(session_id, instructor_id)

        normalized_student_id = student_id.strip()
        if not normalized_student_id:
            raise ValueError("Student ID cannot be empty")

        if not student_name.strip():
            raise ValueError("Student name cannot be empty")

        if self.repo.roster_entry_exists(session_id, normalized_student_id):
            raise ValueError(f"Student {normalized_student_id} already exists in this session's roster")

        try:
            entry = self.repo.add_roster_entry(
                session_id, normalized_student_id, student_name.strip()
            )
            self.repo.commit()
            return entry
        except Exception:
            self.repo.rollback()
            raise

    def delete_roster_entry(
        self, session_id: int, instructor_id: int, entry_id: int
    ) -> None:
        self._get_owned_session(session_id, instructor_id)

        entry = self.repo.get_roster_entry_by_id(entry_id)
        if not entry or entry.monitoring_session_id != session_id:
            raise ValueError("Roster entry not found")

        try:
            self.repo.delete_roster_entry(entry)
            self.repo.commit()
        except Exception:
            self.repo.rollback()
            raise

    def upload_roster_csv(
        self, session_id: int, instructor_id: int, csv_content: str
    ) -> dict:
        """Parse CSV and add roster entries. Returns summary."""
        self._get_owned_session(session_id, instructor_id)

        added = 0
        skipped = 0
        errors: list[str] = []

        try:
            reader = csv.DictReader(io.StringIO(csv_content))

            # Validate header
            if not reader.fieldnames:
                raise ValueError("CSV file is empty or has no header")

            # Normalize header names
            fieldnames = [f.strip().lower() for f in reader.fieldnames]
            if "student_id" not in fieldnames or "name" not in fieldnames:
                raise ValueError("CSV must have 'student_id' and 'name' columns")

            # Map original fieldnames to normalized
            sid_field = reader.fieldnames[fieldnames.index("student_id")]
            name_field = reader.fieldnames[fieldnames.index("name")]

            for row_num, row in enumerate(reader, start=2):
                student_id = (row.get(sid_field) or "").strip()
                student_name = (row.get(name_field) or "").strip()

                if not student_id:
                    errors.append(f"Row {row_num}: empty student_id")
                    continue

                if not student_name:
                    errors.append(f"Row {row_num}: empty name")
                    continue

                if self.repo.roster_entry_exists(session_id, student_id):
                    skipped += 1
                    continue

                try:
                    self.repo.add_roster_entry(session_id, student_id, student_name)
                    added += 1
                except Exception as e:
                    errors.append(f"Row {row_num}: {str(e)}")

            self.repo.commit()

        except ValueError as e:
            self.repo.rollback()
            raise
        except Exception:
            self.repo.rollback()
            raise

        return {"added": added, "skipped": skipped, "errors": errors}
