"""Create monitoring_events table.

Revision ID: 004_monitoring_events
Revises: 003_participant_sessions
Create Date: 2026-08-28

NOTE: Do NOT apply this migration to real MySQL until manually inspected.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "004_monitoring_events"
down_revision = "003_participant_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monitoring_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("event_id", sa.String(22), nullable=False),
        sa.Column("monitoring_session_id", sa.Integer(), nullable=False),
        sa.Column("participant_session_id", sa.Integer(), nullable=False),
        sa.Column(
            "event_type",
            sa.Enum(
                "phone_detected",
                "multiple_faces",
                "suspicious_object",
                "no_face",
                "fullscreen_exit",
                "tab_switch",
                "camera_obscured",
                "looking_away",
                name="eventtype",
            ),
            nullable=False,
        ),
        sa.Column(
            "severity",
            sa.Enum(
                "low",
                "medium",
                "high",
                name="eventseverity",
            ),
            nullable=False,
        ),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("client_event_id", sa.String(255), nullable=True),
        sa.Column("client_occurred_at", sa.DateTime(), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        # Primary key
        sa.PrimaryKeyConstraint("id"),
        # Foreign keys:
        # - monitoring_session_id CASCADE: deleting a session deletes its events
        # - participant_session_id CASCADE: deleting a participant session deletes its events
        sa.ForeignKeyConstraint(
            ["monitoring_session_id"],
            ["monitoring_sessions.id"],
            name="fk_monitoring_events_monitoring_session",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["participant_session_id"],
            ["participant_sessions.id"],
            name="fk_monitoring_events_participant_session",
            ondelete="CASCADE",
        ),
        # Unique constraints
        sa.UniqueConstraint("event_id", name="uq_monitoring_events_event_id"),
        sa.UniqueConstraint(
            "participant_session_id",
            "client_event_id",
            name="uq_monitoring_event_client_idempotency",
        ),
    )

    # Indexes for efficient queries
    op.create_index(
        "ix_monitoring_events_event_id", "monitoring_events", ["event_id"]
    )
    op.create_index(
        "ix_monitoring_events_monitoring_session_id",
        "monitoring_events",
        ["monitoring_session_id"],
    )
    op.create_index(
        "ix_monitoring_events_participant_session_id",
        "monitoring_events",
        ["participant_session_id"],
    )
    op.create_index(
        "ix_monitoring_events_received_at",
        "monitoring_events",
        ["received_at"],
    )


def downgrade() -> None:
    # MySQL compatible — no DROP TYPE statements
    op.drop_index("ix_monitoring_events_received_at", table_name="monitoring_events")
    op.drop_index(
        "ix_monitoring_events_participant_session_id", table_name="monitoring_events"
    )
    op.drop_index(
        "ix_monitoring_events_monitoring_session_id", table_name="monitoring_events"
    )
    op.drop_index("ix_monitoring_events_event_id", table_name="monitoring_events")
    op.drop_table("monitoring_events")
    # Note: MySQL ENUMs are table-scoped; dropping the table removes them.
