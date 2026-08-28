"""create monitoring sessions and roster tables

Revision ID: 002_monitoring_sessions
Revises: 001_initial_auth
Create Date: 2026-08-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "002_monitoring_sessions"
down_revision: Union[str, None] = "001_initial_auth"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Monitoring sessions table
    op.create_table(
        "monitoring_sessions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("exam_code", sa.String(20), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("course_name", sa.String(300), nullable=True),
        sa.Column("instructor_id", sa.Integer(), nullable=False),
        sa.Column(
            "join_mode",
            sa.Enum("open_join", "roster_required", name="joinmode"),
            nullable=False,
            server_default="open_join",
        ),
        sa.Column(
            "status",
            sa.Enum("draft", "waiting", "live", "ended", "cancelled", name="sessionstatus"),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("starts_at", sa.DateTime(), nullable=True),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
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
        sa.ForeignKeyConstraint(["instructor_id"], ["instructors.id"]),
        sa.UniqueConstraint("exam_code"),
    )
    op.create_index("ix_monitoring_sessions_exam_code", "monitoring_sessions", ["exam_code"], unique=True)
    op.create_index("ix_monitoring_sessions_instructor_id", "monitoring_sessions", ["instructor_id"])

    # Student roster entries table
    op.create_table(
        "student_roster_entries",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("monitoring_session_id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.String(100), nullable=False),
        sa.Column("student_name", sa.String(200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["monitoring_session_id"], ["monitoring_sessions.id"]),
        sa.UniqueConstraint("monitoring_session_id", "student_id", name="uq_session_student"),
    )
    op.create_index("ix_roster_session_id", "student_roster_entries", ["monitoring_session_id"])
    op.create_index("ix_roster_student_id", "student_roster_entries", ["student_id"])


def downgrade() -> None:
    op.drop_index("ix_roster_student_id", table_name="student_roster_entries")
    op.drop_index("ix_roster_session_id", table_name="student_roster_entries")
    op.drop_table("student_roster_entries")
    op.drop_index("ix_monitoring_sessions_instructor_id", table_name="monitoring_sessions")
    op.drop_index("ix_monitoring_sessions_exam_code", table_name="monitoring_sessions")
    op.drop_table("monitoring_sessions")
    # Note: Not using DROP TYPE for MySQL compatibility
    # MySQL enums are handled automatically by SQLAlchemy
