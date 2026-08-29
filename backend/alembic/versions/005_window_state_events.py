"""Add window state event types to monitoring_events enum.

Revision ID: 005_window_state_events
Revises: 004_monitoring_events
Create Date: 2026-08-29

Adds three new EventType values for Phase 5.1 window state monitoring:
- window_minimized
- window_maximized
- window_restored

NOTE: Do NOT apply this migration to real MySQL until manually inspected.
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "005_window_state_events"
down_revision = "004_monitoring_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Extend MySQL ENUM 'eventtype' with three new window state values.

    MySQL 8 approach: ALTER TABLE ... MODIFY COLUMN with the full ENUM list.
    MySQL requires the complete enum value list when modifying a column —
    existing values must be preserved in their original order.
    """
    op.execute(
        """
        ALTER TABLE monitoring_events
        MODIFY COLUMN event_type
            ENUM(
                'phone_detected',
                'multiple_faces',
                'suspicious_object',
                'no_face',
                'fullscreen_exit',
                'tab_switch',
                'camera_obscured',
                'looking_away',
                'window_minimized',
                'window_maximized',
                'window_restored'
            )
            NOT NULL
        """
    )


def downgrade() -> None:
    """Revert the event_type ENUM to its previous set of values.

    WARNING: Any rows with window state event types must be deleted
    before running this downgrade, or MySQL will raise a data truncation error.
    """
    # Delete rows with new enum values first to avoid truncation
    op.execute(
        "DELETE FROM monitoring_events "
        "WHERE event_type IN ('window_minimized', 'window_maximized', 'window_restored')"
    )

    op.execute(
        """
        ALTER TABLE monitoring_events
        MODIFY COLUMN event_type
            ENUM(
                'phone_detected',
                'multiple_faces',
                'suspicious_object',
                'no_face',
                'fullscreen_exit',
                'tab_switch',
                'camera_obscured',
                'looking_away'
            )
            NOT NULL
        """
    )
