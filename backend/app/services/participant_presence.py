"""Presence is connection health, never a risk/cheating signal."""
from datetime import datetime, timedelta
from app.models.participant_session import ParticipantStatus
from app.repositories.participant_repository import ParticipantRepository

PRESENCE_TIMEOUT_SECONDS = 60


def effective_status(participant, now=None):
    now = now or datetime.utcnow()
    if participant.status == ParticipantStatus.MONITORING:
        if not participant.last_seen_at or now - participant.last_seen_at > timedelta(seconds=PRESENCE_TIMEOUT_SECONDS):
            return ParticipantStatus.DISCONNECTED.value
    return participant.status.value


def update_presence(db, psid, status, reconnect=False):
    participant = ParticipantRepository(db).get_participant_by_psid(psid)
    if participant is None:
        return None
    # A delayed ping or socket close must not undo an explicit departure.
    if participant.status == ParticipantStatus.ENDED and not reconnect:
        return None
    participant.status = status
    if status == ParticipantStatus.MONITORING:
        participant.last_seen_at = datetime.utcnow()
        participant.ended_at = None
    elif status == ParticipantStatus.ENDED:
        participant.ended_at = datetime.utcnow()
    db.commit()
    return participant.monitoring_session_id
