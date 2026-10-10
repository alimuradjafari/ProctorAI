from datetime import datetime, timedelta
from types import SimpleNamespace
from app.models.participant_session import ParticipantStatus
from app.repositories.participant_repository import ParticipantRepository
from app.services.participant_presence import effective_status, update_presence
from test_screen_review import register_and_login, create_session_in_status, get_participant_token, INSTRUCTOR_A


def test_stale_connection_is_offline():
    p = SimpleNamespace(status=ParticipantStatus.MONITORING, last_seen_at=datetime.utcnow()-timedelta(seconds=65))
    assert effective_status(p) == 'disconnected'
    p.last_seen_at = datetime.utcnow()
    assert effective_status(p) == 'monitoring'


def test_leave_survives_ping_and_reconnect_restores_online(client, db_session):
    token = register_and_login(client, INSTRUCTOR_A)
    _, code = create_session_in_status(client, token, 'live')
    student_token, psid = get_participant_token(client, code)
    update_presence(db_session, psid, ParticipantStatus.MONITORING, reconnect=True)
    response = client.post('/api/participant-sessions/leave', headers={'Authorization': f'Bearer {student_token}'})
    assert response.status_code == 200
    update_presence(db_session, psid, ParticipantStatus.MONITORING)
    update_presence(db_session, psid, ParticipantStatus.DISCONNECTED)
    p = ParticipantRepository(db_session).get_participant_by_psid(psid)
    assert p.status == ParticipantStatus.ENDED
    update_presence(db_session, psid, ParticipantStatus.MONITORING, reconnect=True)
    assert p.status == ParticipantStatus.MONITORING
    assert p.ended_at is None
    assert p.last_seen_at is not None


def test_socket_lifecycle_records_presence(client, db_session, ws_session_local_with_screen_review):
    token = register_and_login(client, INSTRUCTOR_A)
    _, code = create_session_in_status(client, token, 'live')
    student_token, psid = get_participant_token(client, code)
    with client.websocket_connect('/ws/participant-screen-review') as ws:
        ws.send_json({'type':'authenticate','access_token':student_token})
        assert ws.receive_json()['type'] == 'authenticated'
        ws.send_json({'type':'ping'})
        assert ws.receive_json()['type'] == 'pong'
        p = ParticipantRepository(db_session).get_participant_by_psid(psid)
        assert p.status == ParticipantStatus.MONITORING
        assert p.last_seen_at is not None
    db_session.expire_all()
    assert ParticipantRepository(db_session).get_participant_by_psid(psid).status == ParticipantStatus.DISCONNECTED


def test_leave_requires_auth(client):
    assert client.post('/api/participant-sessions/leave').status_code in (401,403)
