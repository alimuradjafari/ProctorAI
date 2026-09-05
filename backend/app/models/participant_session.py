import enum
import secrets
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, Enum, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ParticipantStatus(str, enum.Enum):
    JOINED = "joined"
    MONITORING = "monitoring"
    DISCONNECTED = "disconnected"
    ENDED = "ended"


def generate_participant_session_id() -> str:
    """Generate a unique opaque participant session identifier.

    Format: PS-<16 hex chars>
    Example: PS-4F7A82D19C0B6E21
    """
    return f"PS-{secrets.token_hex(8).upper()}"


class ParticipantSession(Base):
    __tablename__ = "participant_sessions"
    __table_args__ = (
        UniqueConstraint("monitoring_session_id", "student_id", name="uq_participant_session_student"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    participant_session_id: Mapped[str] = mapped_column(
        String(20), unique=True, index=True, nullable=False
    )
    monitoring_session_id: Mapped[int] = mapped_column(
        ForeignKey("monitoring_sessions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    roster_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("student_roster_entries.id", ondelete="SET NULL"), nullable=True
    )
    student_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    student_name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[ParticipantStatus] = mapped_column(
        Enum(
            ParticipantStatus,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            name="participantstatus",
        ),
        default=ParticipantStatus.JOINED,
        nullable=False,
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    monitoring_session = relationship("MonitoringSession")
    roster_entry = relationship("StudentRosterEntry")
