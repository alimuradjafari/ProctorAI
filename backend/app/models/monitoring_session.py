import enum
import re
import secrets
import string
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, Enum, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class JoinMode(str, enum.Enum):
    OPEN_JOIN = "open_join"
    ROSTER_REQUIRED = "roster_required"


class SessionStatus(str, enum.Enum):
    DRAFT = "draft"
    WAITING = "waiting"
    LIVE = "live"
    ENDED = "ended"
    CANCELLED = "cancelled"


# Valid lifecycle transitions
VALID_TRANSITIONS: dict[SessionStatus, list[SessionStatus]] = {
    SessionStatus.DRAFT: [SessionStatus.WAITING, SessionStatus.CANCELLED],
    SessionStatus.WAITING: [SessionStatus.LIVE, SessionStatus.CANCELLED],
    SessionStatus.LIVE: [SessionStatus.ENDED],
    SessionStatus.ENDED: [],
    SessionStatus.CANCELLED: [],
}


def generate_exam_code(prefix_source: str = "") -> str:
    """Generate a human-friendly exam code like DSA-8K7P2.

    Uses a sanitized short prefix from the title/course plus a random
    uppercase alphanumeric suffix. Collision checking is done at the
    service layer before insertion.
    """
    # Build prefix from source text
    prefix = ""
    if prefix_source:
        # Take first letters of words, max 3 chars
        words = re.findall(r'[A-Za-z]+', prefix_source)
        prefix = "".join(w[0].upper() for w in words[:3])

    if not prefix:
        prefix = "EXM"

    # Random suffix: 5 uppercase alphanumeric chars
    suffix = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(5))
    return f"{prefix}-{suffix}"


class MonitoringSession(Base):
    __tablename__ = "monitoring_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    exam_code: Mapped[str] = mapped_column(
        String(20), unique=True, index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    course_name: Mapped[str] = mapped_column(String(300), nullable=True)
    instructor_id: Mapped[int] = mapped_column(
        ForeignKey("instructors.id"), index=True, nullable=False
    )
    join_mode: Mapped[JoinMode] = mapped_column(
        Enum(
            JoinMode,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            name="joinmode",
        ),
        default=JoinMode.OPEN_JOIN,
        nullable=False,
    )
    status: Mapped[SessionStatus] = mapped_column(
        Enum(
            SessionStatus,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            name="sessionstatus",
        ),
        default=SessionStatus.DRAFT,
        nullable=False,
    )
    starts_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    instructor = relationship("Instructor")
    roster_entries: Mapped[list["StudentRosterEntry"]] = relationship(
        back_populates="monitoring_session", cascade="all, delete-orphan"
    )


class StudentRosterEntry(Base):
    __tablename__ = "student_roster_entries"
    __table_args__ = (
        UniqueConstraint("monitoring_session_id", "student_id", name="uq_session_student"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    monitoring_session_id: Mapped[int] = mapped_column(
        ForeignKey("monitoring_sessions.id"), index=True, nullable=False
    )
    student_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    student_name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    monitoring_session: Mapped["MonitoringSession"] = relationship(
        back_populates="roster_entries"
    )
