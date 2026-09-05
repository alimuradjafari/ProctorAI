"""Monitoring event model and event type contract."""

import enum
import secrets
from datetime import datetime

from sqlalchemy import (
    String,
    DateTime,
    Float,
    ForeignKey,
    Enum,
    Index,
    UniqueConstraint,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


# ---------------------------------------------------------------------------
# Event type contract — detectors implemented in later phases
# ---------------------------------------------------------------------------


class EventType(str, enum.Enum):
    PHONE_DETECTED = "phone_detected"
    MULTIPLE_FACES = "multiple_faces"
    SUSPICIOUS_OBJECT = "suspicious_object"
    NO_FACE = "no_face"
    FULLSCREEN_EXIT = "fullscreen_exit"
    TAB_SWITCH = "tab_switch"
    CAMERA_OBSCURED = "camera_obscured"
    LOOKING_AWAY = "looking_away"
    WINDOW_MINIMIZED = "window_minimized"
    WINDOW_MAXIMIZED = "window_maximized"
    WINDOW_RESTORED = "window_restored"
    BROWSER_SIDE_PANEL = "browser_side_panel"
    EXAM_WINDOW_FOCUS_LOST = "exam_window_focus_lost"


class EventSeverity(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


# Server-owned severity map — clients never submit severity
SEVERITY_MAP: dict[EventType, EventSeverity] = {
    EventType.PHONE_DETECTED: EventSeverity.HIGH,
    EventType.MULTIPLE_FACES: EventSeverity.HIGH,
    EventType.SUSPICIOUS_OBJECT: EventSeverity.MEDIUM,
    EventType.NO_FACE: EventSeverity.MEDIUM,
    EventType.FULLSCREEN_EXIT: EventSeverity.MEDIUM,
    EventType.TAB_SWITCH: EventSeverity.MEDIUM,
    EventType.CAMERA_OBSCURED: EventSeverity.MEDIUM,
    EventType.LOOKING_AWAY: EventSeverity.LOW,
    EventType.WINDOW_MINIMIZED: EventSeverity.MEDIUM,
    EventType.WINDOW_MAXIMIZED: EventSeverity.LOW,
    EventType.WINDOW_RESTORED: EventSeverity.LOW,
    EventType.BROWSER_SIDE_PANEL: EventSeverity.MEDIUM,
    EventType.EXAM_WINDOW_FOCUS_LOST: EventSeverity.MEDIUM,
}

# Maximum serialized metadata size in bytes (approximately 8 KB)
MAX_METADATA_BYTES = 8 * 1024


def generate_event_id() -> str:
    """Generate a unique opaque event identifier.

    Format: EV-<16 hex chars>
    Example: EV-4F82193A6CE04711
    """
    return f"EV-{secrets.token_hex(8).upper()}"


class MonitoringEvent(Base):
    """Persisted monitoring event submitted by a participant."""

    __tablename__ = "monitoring_events"
    __table_args__ = (
        UniqueConstraint(
            "participant_session_id",
            "client_event_id",
            name="uq_monitoring_event_client_idempotency",
        ),
        Index("ix_monitoring_events_received_at", "received_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Opaque public event identifier — server-generated, not DB PK
    event_id: Mapped[str] = mapped_column(
        String(22), unique=True, index=True, nullable=False
    )

    # Denormalized for efficient instructor queries — populated server-side only
    monitoring_session_id: Mapped[int] = mapped_column(
        ForeignKey("monitoring_sessions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    # FK to participant_sessions — CASCADE avoids blocking session cleanup
    participant_session_id: Mapped[int] = mapped_column(
        ForeignKey("participant_sessions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    # Validated event type — bounded SQLAlchemy Enum (values_callable)
    event_type: Mapped[EventType] = mapped_column(
        Enum(
            EventType,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            name="eventtype",
        ),
        nullable=False,
    )

    # Server-derived display severity
    severity: Mapped[EventSeverity] = mapped_column(
        Enum(
            EventSeverity,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            name="eventseverity",
        ),
        nullable=False,
    )

    # AI events may provide confidence; deterministic events may use null or 1.0
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Idempotency key — nullable, unique within (participant_session_id, client_event_id)
    client_event_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )

    # Informational only — not authoritative
    client_occurred_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )

    # Small JSON metadata only — size enforced in service layer
    metadata_json: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="{}",
    )

    # Authoritative server receipt timestamp
    received_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
