"""Add browser_side_panel event type to monitoring_events enum.

Revision ID: 006_browser_side_panel
Revises: 005_window_state_events
Create Date: 2026-09-04

Adds one new EventType value for Phase 9.1 browser side-panel monitoring:
- browser_side_panel

NOTE: Do NOT apply this migration to real MySQL until manually inspected.
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "006_browser_side_panel"
down_revision = "005_window_state_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Extend MySQL ENUM 'eventtype' with the browser_side_panel value.

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
                'window_restored',
                'browser_side_panel'
            )
            NOT NULL
        """
    )


def downgrade() -> None:
    """Revert the event_type ENUM to its previous set of values.

    WARNING: Any rows with browser_side_panel events must be deleted
    before running this downgrade, or MySQL will raise a data truncation error.
    """
    # Delete rows with the new enum value first to avoid truncation
    op.execute(
        "DELETE FROM monitoring_events "
        "WHERE event_type = 'browser_side_panel'"
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
                'looking_away',
                'window_minimized',
                'window_maximized',
                'window_restored'
            )
            NOT NULL
        """
    )
