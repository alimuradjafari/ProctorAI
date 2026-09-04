"""Tests for exam_window_focus_lost monitoring events (Phase 9.2).

Covers the spec-mandated cases:
  1. exam_window_focus_lost event accepted
  2. backend severity is MEDIUM
  3. client cannot override severity
  4. event appears in history
  5. WebSocket broadcasts event (+ live risk update)
  6. participant risk increases by base weight 15
  7. duplicate client_event_id does not increase risk
  8. repeated episodes use diminishing returns
  9. participant token cannot access instructor-only endpoints
 10. instructor ownership/security unchanged
"""

from unittest.mock import patch

from app.models.monitoring_event import EventType, EventSeverity, SEVERITY_MAP


# --- Test data ---

INSTRUCTOR_A = {
    "full_name": "Dr. Ahmed",
    "email": "focus-ahmed@university.edu",
    "password": "SecurePass123!",
}

INSTRUCTOR_B = {
    "full_name": "Dr. Sara",
    "email": "focus-sara@university.edu",
    "password": "SecurePass456!",
}

SESSION_OPEN = {
    "title": "Focus Loss Test Exam",
    "course_name": "CS101",
    "join_mode": "open_join",
}

# Safe focus metadata per Phase 9.2 spec section 9 — the ONLY fields allowed:
# source, focus_destination (one of two values), persistence_ms.
FOCUS_METADATA = {
    "source": "chrome_windows_focus",
    "focus_destination": "outside_chrome",
    "persistence_ms": 620,
}

FOCUS_METADATA_OTHER_CHROME = {
    "source": "chrome_windows_focus",
    "focus_destination": "other_chrome_window",
    "persistence_ms": 710,
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

    raise ValueError(f"Unknown status: {status}")


def get_participant_token(client, exam_code, student_id="2024-cs-001", student_name="Ali Khan"):
    resp = client.post(
        "/api/participant-sessions/join",
        json={
            "exam_code": exam_code,
            "student_id": student_id,
            "student_name": student_name,
        },
    )
    data = resp.json()
    return data["participant_access_token"], data["participant_session_id"]


def submit_event(client, token, event_type="exam_window_focus_lost", **kwargs):
    payload = {"event_type": event_type}
    payload.update(kwargs)
    return client.post(
        "/api/participant-sessions/events",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )


def get_risk(client, token, sid):
    resp = client.get(
        f"/api/monitoring-sessions/{sid}/risk", headers=auth_headers(token)
    )
    assert resp.status_code == 200
    return resp.json()["participants"][0]


# ==================== 1. EVENT ACCEPTED ====================


def test_exam_window_focus_lost_event_accepted(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    resp = submit_event(
        client,
        p_token,
        "exam_window_focus_lost",
        client_event_id="focus-accept-1",
        metadata=FOCUS_METADATA,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["event_id"].startswith("EV-")
    assert data["event_type"] == "exam_window_focus_lost"
    assert data["participant"]["student_id"] == "2024-cs-001"
    # Safe focus metadata round-trips unchanged
    assert data["metadata"]["source"] == "chrome_windows_focus"
    assert data["metadata"]["focus_destination"] == "outside_chrome"
    assert data["metadata"]["persistence_ms"] == 620


def test_exam_window_focus_lost_other_chrome_destination_accepted(client):
    """Both allowed focus_destination values must be accepted."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    resp = submit_event(
        client,
        p_token,
        "exam_window_focus_lost",
        client_event_id="focus-accept-2",
        metadata=FOCUS_METADATA_OTHER_CHROME,
    )
    assert resp.status_code == 201
    assert resp.json()["metadata"]["focus_destination"] == "other_chrome_window"


def test_exam_window_focus_lost_rejected_when_session_not_live(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "waiting")
    resp = client.post(
        "/api/participant-sessions/join",
        json={
            "exam_code": exam_code,
            "student_id": "2024-cs-001",
            "student_name": "Ali Khan",
        },
    )
    if resp.status_code == 200:
        p_token = resp.json()["participant_access_token"]
        resp = submit_event(client, p_token, "exam_window_focus_lost")
        assert resp.status_code == 400


# ==================== 2. BACKEND SEVERITY IS MEDIUM ====================


def test_exam_window_focus_lost_severity_is_medium(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    resp = submit_event(client, p_token, "exam_window_focus_lost", client_event_id="focus-sev-1")
    assert resp.status_code == 201
    assert resp.json()["severity"] == "medium"


def test_severity_map_contains_exam_window_focus_lost():
    """Server-owned severity map must map exam_window_focus_lost -> MEDIUM."""
    assert SEVERITY_MAP[EventType.EXAM_WINDOW_FOCUS_LOST] == EventSeverity.MEDIUM


# ==================== 3. CLIENT CANNOT OVERRIDE SEVERITY ====================


def test_client_cannot_override_severity(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    resp = client.post(
        "/api/participant-sessions/events",
        json={"event_type": "exam_window_focus_lost", "severity": "high"},
        headers={"Authorization": f"Bearer {p_token}"},
    )
    assert resp.status_code == 422  # Pydantic extra=forbid


def test_client_cannot_send_risk_data(client):
    """Client-supplied risk score/level must be rejected outright."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    resp = client.post(
        "/api/participant-sessions/events",
        json={"event_type": "exam_window_focus_lost", "risk_score": 99, "risk_level": "critical"},
        headers={"Authorization": f"Bearer {p_token}"},
    )
    assert resp.status_code == 422


# ==================== 4. EVENT APPEARS IN HISTORY ====================


def test_exam_window_focus_lost_appears_in_history(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(
        client, p_token, "exam_window_focus_lost",
        client_event_id="focus-hist-1", metadata=FOCUS_METADATA,
    )

    resp = client.get(
        f"/api/monitoring-sessions/{sid}/events", headers=auth_headers(token)
    )
    assert resp.status_code == 200
    events = resp.json()["events"]
    assert len(events) == 1
    assert events[0]["event_type"] == "exam_window_focus_lost"
    assert events[0]["severity"] == "medium"
    assert events[0]["metadata"]["source"] == "chrome_windows_focus"
    assert events[0]["participant"]["student_id"] == "2024-cs-001"


# ==================== 5. WEBSOCKET BROADCASTS EVENT ====================


def test_ws_broadcasts_exam_window_focus_lost_event(client, ws_session_local, db_session):
    """Instructor socket receives the event broadcast and the live risk update."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    class NoCloseSession:
        def __init__(self):
            self._session = db_session

        def __getattr__(self, name):
            return getattr(self._session, name)

        def close(self):
            pass

    with client.websocket_connect(f"/ws/monitoring-sessions/{sid}") as ws:
        ws.send_json({"type": "authenticate", "access_token": token})
        assert ws.receive_json()["type"] == "authenticated"

        # The risk broadcast opens app.core.database.SessionLocal directly —
        # patch it to the shared test session so the risk query sees the
        # event committed by the API's overridden session.
        with patch("app.core.database.SessionLocal", lambda: NoCloseSession()):
            resp = submit_event(
                client, p_token, "exam_window_focus_lost",
                client_event_id="focus-ws-1", metadata=FOCUS_METADATA,
            )
        assert resp.status_code == 201

        # First broadcast: the monitoring event itself
        event_msg = ws.receive_json()
        assert event_msg["type"] == "monitoring_event"
        assert event_msg["event"]["event_type"] == "exam_window_focus_lost"
        assert event_msg["event"]["severity"] == "medium"
        assert event_msg["event"]["metadata"]["source"] == "chrome_windows_focus"
        assert event_msg["event"]["metadata"]["focus_destination"] == "outside_chrome"

        # Second broadcast: live risk update (Phase 9)
        risk_msg = ws.receive_json()
        assert risk_msg["type"] == "participant_risk_updated"
        assert risk_msg["risk_score"] == 15
        assert risk_msg["risk_level"] == "low"
        assert risk_msg["total_events"] == 1


# ==================== 6. RISK INCREASES BY BASE WEIGHT 15 ====================


def test_exam_window_focus_lost_risk_increases_by_base_weight(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "exam_window_focus_lost", client_event_id="focus-risk-1")

    p = get_risk(client, token, sid)
    assert p["total_events"] == 1
    assert p["risk_score"] == 15  # base weight, first occurrence at 100%
    assert p["risk_level"] == "low"
    assert p["medium_severity_events"] == 1


def test_exam_window_focus_lost_counts_as_medium_severity(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "exam_window_focus_lost", client_event_id="focus-sevcount-1")

    p = get_risk(client, token, sid)
    assert p["high_severity_events"] == 0
    assert p["medium_severity_events"] == 1
    assert p["low_severity_events"] == 0


# ==================== 7. DUPLICATE CLIENT_EVENT_ID DOES NOT INCREASE RISK ====================


def test_duplicate_client_event_id_does_not_increase_risk(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    client_eid = "focus-dup-1"
    resp1 = submit_event(client, p_token, "exam_window_focus_lost", client_event_id=client_eid)
    resp2 = submit_event(client, p_token, "exam_window_focus_lost", client_event_id=client_eid)
    resp3 = submit_event(client, p_token, "exam_window_focus_lost", client_event_id=client_eid)

    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp3.status_code == 201
    assert resp1.json()["event_id"] == resp2.json()["event_id"] == resp3.json()["event_id"]

    p = get_risk(client, token, sid)
    assert p["total_events"] == 1
    assert p["risk_score"] == 15  # Not 24, not 28


# ==================== 8. REPEATED EPISODES USE DIMINISHING RETURNS ====================


def test_exam_window_focus_lost_diminishing_risk(client):
    """x1=15, x2=15+9=24, x3=15+9+4.5 -> 28 (existing rounding)."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    # 1st episode: 15 * 1.0 = 15
    submit_event(client, p_token, "exam_window_focus_lost", client_event_id="focus-dim-1")
    assert get_risk(client, token, sid)["risk_score"] == 15

    # 2nd episode: + 15 * 0.6 = 9 -> cumulative 24
    submit_event(client, p_token, "exam_window_focus_lost", client_event_id="focus-dim-2")
    assert get_risk(client, token, sid)["risk_score"] == 24

    # 3rd episode: + 15 * 0.3 = 4.5 -> cumulative 28.5 -> 28
    submit_event(client, p_token, "exam_window_focus_lost", client_event_id="focus-dim-3")
    assert get_risk(client, token, sid)["risk_score"] == 28


def test_exam_window_focus_lost_mixes_with_other_event_types(client):
    """exam_window_focus_lost (15) + tab_switch (10) -> 25."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "exam_window_focus_lost", client_event_id="focus-mix-1")
    submit_event(client, p_token, "tab_switch", client_event_id="focus-mix-2")

    p = get_risk(client, token, sid)
    assert p["total_events"] == 2
    assert p["risk_score"] == 25


# ==================== 9. PARTICIPANT TOKEN CANNOT ACCESS INSTRUCTOR ENDPOINTS ====================


def test_participant_token_cannot_view_events_or_risk(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "exam_window_focus_lost", client_event_id="focus-ptoken-1")

    resp = client.get(
        f"/api/monitoring-sessions/{sid}/events",
        headers={"Authorization": f"Bearer {p_token}"},
    )
    assert resp.status_code == 401

    resp = client.get(
        f"/api/monitoring-sessions/{sid}/risk",
        headers={"Authorization": f"Bearer {p_token}"},
    )
    assert resp.status_code in (401, 403)


# ==================== 10. INSTRUCTOR OWNERSHIP / SECURITY ====================


def test_another_instructor_cannot_see_focus_events(client):
    token_a = register_and_login(client, INSTRUCTOR_A)
    token_b = register_and_login(client, INSTRUCTOR_B)
    sid_a, exam_code_a = create_session_in_status(client, token_a, "live")
    p_token, _ = get_participant_token(client, exam_code_a)

    submit_event(client, p_token, "exam_window_focus_lost", client_event_id="focus-own-1")

    # Instructor B cannot list events from A's session
    resp = client.get(
        f"/api/monitoring-sessions/{sid_a}/events", headers=auth_headers(token_b)
    )
    assert resp.status_code == 404

    # Instructor B cannot view risk from A's session
    resp = client.get(
        f"/api/monitoring-sessions/{sid_a}/risk", headers=auth_headers(token_b)
    )
    assert resp.status_code == 404


# ==================== REGRESSION ====================


def test_existing_event_types_still_accepted(client):
    """All pre-existing event types must keep working after Phase 9.2."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    for event_type in [
        "tab_switch",
        "fullscreen_exit",
        "window_minimized",
        "window_maximized",
        "window_restored",
        "browser_side_panel",
        "looking_away",
        "camera_obscured",
        "phone_detected",
    ]:
        resp = submit_event(client, p_token, event_type, client_event_id=f"reg-{event_type}")
        assert resp.status_code == 201, f"Regression: {event_type} no longer accepted"
