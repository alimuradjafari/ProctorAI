"""create participant sessions table

Revision ID: 003_participant_sessions
Revises: 002_monitoring_sessions
Create Date: 2026-08-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "003_participant_sessions"
down_revision: Union[str, None] = "002_monitoring_sessions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "participant_sessions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("participant_session_id", sa.String(20), nullable=False),
        sa.Column("monitoring_session_id", sa.Integer(), nullable=False),
        sa.Column("roster_entry_id", sa.Integer(), nullable=True),
        sa.Column("student_id", sa.String(100), nullable=False),
        sa.Column("student_name", sa.String(200), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "joined", "monitoring", "disconnected", "ended",
                name="participantstatus",
            ),
            nullable=False,
            server_default="joined",
        ),
        sa.Column(
            "joined_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["monitoring_session_id"], ["monitoring_sessions.id"], ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["roster_entry_id"], ["student_roster_entries.id"], ondelete="SET NULL",
        ),
        sa.UniqueConstraint("participant_session_id"),
        sa.UniqueConstraint(
            "monitoring_session_id", "student_id",
            name="uq_participant_session_student",
        ),
    )
    op.create_index(
        "ix_participant_sessions_psid",
        "participant_sessions",
        ["participant_session_id"],
        unique=True,
    )
    op.create_index(
        "ix_participant_sessions_msid",
        "participant_sessions",
        ["monitoring_session_id"],
    )
    op.create_index(
        "ix_participant_sessions_student_id",
        "participant_sessions",
        ["student_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_participant_sessions_student_id", table_name="participant_sessions")
    op.drop_index("ix_participant_sessions_msid", table_name="participant_sessions")
    op.drop_index("ix_participant_sessions_psid", table_name="participant_sessions")
    op.drop_table("participant_sessions")
