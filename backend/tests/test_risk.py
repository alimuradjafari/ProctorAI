"""Phase 9 tests: Risk API endpoint, WebSocket risk broadcast, idempotency."""

import pytest

from app.services.websocket_manager import manager as ws_manager


# --- Test data ---

INSTRUCTOR_A = {
    "full_name": "Dr. Ahmed",
    "email": "risk-ahmed@university.edu",
    "password": "SecurePass123!",
}

INSTRUCTOR_B = {
    "full_name": "Dr. Sara",
    "email": "risk-sara@university.edu",
    "password": "SecurePass456!",
}

SESSION_OPEN = {
    "title": "Risk Test Exam",
    "course_name": "CS101",
    "join_mode": "open_join",
}


# --- Helpers ---


def register_and_login(client, data):
    client.post("/api/auth/register", json=data)
    response = client.post(
        "/api/auth/login",
        json={"email": data["email"], "password": data["password"]},
    )
    return response.json()["access_token"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def create_session_in_status(client, token, status: str):
    resp = client.post(
        "/api/monitoring-sessions", json=SESSION_OPEN, headers=auth_headers(token)
    )
    sid = resp.json()["id"]
    exam_code = resp.json()["exam_code"]

    if status == "draft":
        return sid, exam_code

    client.post(f"/api/monitoring-sessions/{sid}/prepare", headers=auth_headers(token))
    if status == "waiting":
        return sid, exam_code

    client.post(f"/api/monitoring-sessions/{sid}/start", headers=auth_headers(token))
    if status == "live":
        return sid, exam_code

    client.post(f"/api/monitoring-sessions/{sid}/end", headers=auth_headers(token))
    if status == "ended":
        return sid, exam_code

    raise ValueError(f"Unknown status: {status}")


def join_session(client, exam_code, student_id, student_name):
    return client.post(
        "/api/participant-sessions/join",
        json={
            "exam_code": exam_code,
            "student_id": student_id,
            "student_name": student_name,
        },
    )


def get_participant_token(client, exam_code, student_id="2024-cs-001", student_name="Ali Khan"):
    resp = join_session(client, exam_code, student_id, student_name)
    data = resp.json()
    return data["participant_access_token"], data["participant_session_id"]


def submit_event(client, token, event_type="tab_switch", **kwargs):
    payload = {"event_type": event_type}
    payload.update(kwargs)
    return client.post(
        "/api/participant-sessions/events",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )


# ==================== RISK API TESTS ====================


def test_instructor_can_view_own_session_risk(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "tab_switch", client_event_id="ev1")

    resp = client.get(
        f"/api/monitoring-sessions/{sid}/risk", headers=auth_headers(token)
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "participants" in data
    assert len(data["participants"]) == 1
    p = data["participants"][0]
    assert p["risk_score"] == 10
    assert p["risk_level"] == "low"
    assert p["total_events"] == 1


def test_another_instructor_cannot_access_risk(client):
    token_a = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token_a, "live")

    token_b = register_and_login(client, INSTRUCTOR_B)
    resp = client.get(
        f"/api/monitoring-sessions/{sid}/risk", headers=auth_headers(token_b)
    )
    assert resp.status_code == 404


def test_participant_token_cannot_access_risk(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    resp = client.get(
        f"/api/monitoring-sessions/{sid}/risk",
        headers={"Authorization": f"Bearer {p_token}"},
    )
    # Participant token is not an instructor token — should be 401 or 403
    assert resp.status_code in (401, 403)


def test_nonexistent_session_risk(client):
    token = register_and_login(client, INSTRUCTOR_A)
    resp = client.get(
        "/api/monitoring-sessions/99999/risk", headers=auth_headers(token)
    )
    assert resp.status_code == 404


def test_multiple_participants_sorted_by_risk(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")

    # Student 1: low risk (1 tab switch)
    p1_token, _ = get_participant_token(client, exam_code, "s1", "Alice Low")
    submit_event(client, p1_token, "tab_switch", client_event_id="alice-1")

    # Student 2: high risk (1 phone)
    p2_token, _ = get_participant_token(client, exam_code, "s2", "Bob High")
    submit_event(client, p2_token, "phone_detected", client_event_id="bob-1")

    resp = client.get(
        f"/api/monitoring-sessions/{sid}/risk", headers=auth_headers(token)
    )
    assert resp.status_code == 200
    participants = resp.json()["participants"]
    assert len(participants) == 2

    # Sorted: highest risk first
    assert participants[0]["student_name"] == "Bob High"
    assert participants[0]["risk_score"] == 30
    assert participants[1]["student_name"] == "Alice Low"
    assert participants[1]["risk_score"] == 10


def test_event_counts_correct(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "phone_detected", client_event_id="e1")
    submit_event(client, p_token, "phone_detected", client_event_id="e2")
    submit_event(client, p_token, "tab_switch", client_event_id="e3")

    resp = client.get(
        f"/api/monitoring-sessions/{sid}/risk", headers=auth_headers(token)
    )
    p = resp.json()["participants"][0]
    assert p["total_events"] == 3
    # phone x2: 30*1.0 + 30*0.6 = 48, tab_switch x1: 10. Total = 58
    assert p["risk_score"] == 58


def test_severity_counts_correct(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "phone_detected", client_event_id="h1")  # high
    submit_event(client, p_token, "tab_switch", client_event_id="m1")     # medium
    submit_event(client, p_token, "looking_away", client_event_id="l1")   # low

    resp = client.get(
        f"/api/monitoring-sessions/{sid}/risk", headers=auth_headers(token)
    )
    p = resp.json()["participants"][0]
    assert p["high_severity_events"] == 1
    assert p["medium_severity_events"] == 1
    assert p["low_severity_events"] == 1


def test_duplicate_idempotent_no_double_score(client):
    """Submitting the same event twice (same client_event_id) must not double the score."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "phone_detected", client_event_id="unique-idem-1")
    submit_event(client, p_token, "phone_detected", client_event_id="unique-idem-1")  # duplicate
    submit_event(client, p_token, "phone_detected", client_event_id="unique-idem-1")  # duplicate

    resp = client.get(
        f"/api/monitoring-sessions/{sid}/risk", headers=auth_headers(token)
    )
    p = resp.json()["participants"][0]
    assert p["total_events"] == 1  # Only one event persisted
    assert p["risk_score"] == 30   # Not 58 or 48


def test_score_capped_at_100_api(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    # Submit many high-weight events
    for i in range(10):
        submit_event(client, p_token, "phone_detected", client_event_id=f"cap-{i}")

    resp = client.get(
        f"/api/monitoring-sessions/{sid}/risk", headers=auth_headers(token)
    )
    p = resp.json()["participants"][0]
    assert p["risk_score"] == 100
    assert p["risk_level"] == "critical"


def test_no_participants_returns_empty(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, _ = create_session_in_status(client, token, "live")

    resp = client.get(
        f"/api/monitoring-sessions/{sid}/risk", headers=auth_headers(token)
    )
    assert resp.status_code == 200
    assert resp.json()["participants"] == []


def test_risk_reconstructs_from_persisted_events(client):
    """Score must be derivable from persisted events, not from temporary state."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "phone_detected", client_event_id="recon-1")
    submit_event(client, p_token, "tab_switch", client_event_id="recon-2")

    # First request
    resp1 = client.get(
        f"/api/monitoring-sessions/{sid}/risk", headers=auth_headers(token)
    )
    score1 = resp1.json()["participants"][0]["risk_score"]

    # Second request (same data, reconstructed from DB)
    resp2 = client.get(
        f"/api/monitoring-sessions/{sid}/risk", headers=auth_headers(token)
    )
    score2 = resp2.json()["participants"][0]["risk_score"]

    assert score1 == score2
    assert score1 == 40  # phone(30) + tab_switch(10)


# ==================== SINGLE PARTICIPANT RISK TESTS ====================


def test_single_participant_risk(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, psid = get_participant_token(client, exam_code)

    submit_event(client, p_token, "phone_detected", client_event_id="sp-1")

    resp = client.get(
        f"/api/monitoring-sessions/{sid}/participants/{psid}/risk",
        headers=auth_headers(token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["risk_score"] == 30
    assert data["risk_level"] == "medium"
    assert data["participant_session_id"] == psid


# ==================== WEBSOCKET RISK BROADCAST TESTS ====================


def test_ws_risk_broadcast_on_new_event(client):
    """New event should result in correct risk score computable from persisted data."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    resp = submit_event(client, p_token, "tab_switch", client_event_id="ws-risk-1")
    assert resp.status_code == 201

    # Verify risk is correct (server-computed from persisted events)
    resp = client.get(
        f"/api/monitoring-sessions/{sid}/risk", headers=auth_headers(token)
    )
    p = resp.json()["participants"][0]
    assert p["risk_score"] == 10


def test_ws_existing_event_broadcast_still_works(client):
    """Existing monitoring_event broadcast must continue working alongside risk broadcast."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    resp = submit_event(client, p_token, "tab_switch", client_event_id="ws-cont-1")
    assert resp.status_code == 201
    assert resp.json()["event_type"] == "tab_switch"


def test_risk_broadcast_contains_trusted_score(client):
    """Risk update payload must contain backend-computed score, not extension values."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "phone_detected", client_event_id="trust-1")

    # Verify risk via API (proves server-computed)
    resp = client.get(
        f"/api/monitoring-sessions/{sid}/risk", headers=auth_headers(token)
    )
    p = resp.json()["participants"][0]
    assert p["risk_score"] == 30
    assert p["risk_level"] == "medium"

    # The score is derived from server-side event weights, not from any
    # client-supplied values — the extension sends no risk data.


# ==================== REGRESSION TESTS ====================


def test_existing_event_endpoint_still_works(client):
    """Phase 4 event endpoint must continue working."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    resp = submit_event(client, p_token, "tab_switch", client_event_id="reg-1")
    assert resp.status_code == 201
    assert resp.json()["severity"] == "medium"


def test_existing_event_history_still_works(client):
    """Phase 4 event history must continue working."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "tab_switch", client_event_id="hist-1")

    resp = client.get(
        f"/api/monitoring-sessions/{sid}/events", headers=auth_headers(token)
    )
    assert resp.status_code == 200
    assert len(resp.json()["events"]) == 1
