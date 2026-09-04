"""Phase 9.1 tests: browser_side_panel event — ingestion, severity, risk, WebSocket.

Covers the spec-mandated cases:
  1. browser_side_panel event accepted
  2. backend severity is MEDIUM
  3. client cannot override severity
  4. event appears in history
  5. WebSocket broadcasts event (+ live risk update)
  6. participant risk increases by base weight 15
  7. duplicate client_event_id does not increase risk
  8. diminishing risk behavior remains correct
  9. instructor ownership/security unchanged
"""

from unittest.mock import patch

from app.models.monitoring_event import EventType, EventSeverity, SEVERITY_MAP


# --- Test data ---

INSTRUCTOR_A = {
    "full_name": "Dr. Ahmed",
    "email": "panel-ahmed@university.edu",
    "password": "SecurePass123!",
}

INSTRUCTOR_B = {
    "full_name": "Dr. Sara",
    "email": "panel-sara@university.edu",
    "password": "SecurePass456!",
}

SESSION_OPEN = {
    "title": "Side Panel Test Exam",
    "course_name": "CS101",
    "join_mode": "open_join",
}

# Safe geometry metadata per Phase 9.1 spec section 17 — numbers only
PANEL_METADATA = {
    "source": "viewport_geometry",
    "baseline_inner_width": 1470,
    "current_inner_width": 1110,
    "width_delta_px": 360,
    "shrink_ratio": 0.245,
    "baseline_outer_width": 1500,
    "current_outer_width": 1500,
    "inset_delta_px": 360,
    "persistence_ms": 620,
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


def submit_event(client, token, event_type="browser_side_panel", **kwargs):
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


def test_browser_side_panel_event_accepted(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    resp = submit_event(
        client,
        p_token,
        "browser_side_panel",
        client_event_id="panel-accept-1",
        metadata=PANEL_METADATA,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["event_id"].startswith("EV-")
    assert data["event_type"] == "browser_side_panel"
    assert data["participant"]["student_id"] == "2024-cs-001"
    # Safe geometry metadata round-trips unchanged
    assert data["metadata"]["source"] == "viewport_geometry"
    assert data["metadata"]["baseline_inner_width"] == 1470
    assert data["metadata"]["current_inner_width"] == 1110
    assert data["metadata"]["width_delta_px"] == 360
    assert data["metadata"]["shrink_ratio"] == 0.245
    assert data["metadata"]["inset_delta_px"] == 360
    assert data["metadata"]["persistence_ms"] == 620


def test_browser_side_panel_rejected_when_session_not_live(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "waiting")
    # Cannot join a WAITING session? Joins are allowed in WAITING/LIVE per
    # existing architecture — but events require LIVE.
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
        resp = submit_event(client, p_token, "browser_side_panel")
        assert resp.status_code == 400


# ==================== 2. BACKEND SEVERITY IS MEDIUM ====================


def test_browser_side_panel_severity_is_medium(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    resp = submit_event(client, p_token, "browser_side_panel", client_event_id="panel-sev-1")
    assert resp.status_code == 201
    assert resp.json()["severity"] == "medium"


def test_severity_map_contains_browser_side_panel():
    """Server-owned severity map must map browser_side_panel -> MEDIUM."""
    assert SEVERITY_MAP[EventType.BROWSER_SIDE_PANEL] == EventSeverity.MEDIUM


# ==================== 3. CLIENT CANNOT OVERRIDE SEVERITY ====================


def test_client_cannot_override_severity(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    resp = client.post(
        "/api/participant-sessions/events",
        json={"event_type": "browser_side_panel", "severity": "high"},
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
        json={"event_type": "browser_side_panel", "risk_score": 99, "risk_level": "critical"},
        headers={"Authorization": f"Bearer {p_token}"},
    )
    assert resp.status_code == 422


# ==================== 4. EVENT APPEARS IN HISTORY ====================


def test_browser_side_panel_appears_in_history(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(
        client, p_token, "browser_side_panel",
        client_event_id="panel-hist-1", metadata=PANEL_METADATA,
    )

    resp = client.get(
        f"/api/monitoring-sessions/{sid}/events", headers=auth_headers(token)
    )
    assert resp.status_code == 200
    events = resp.json()["events"]
    assert len(events) == 1
    assert events[0]["event_type"] == "browser_side_panel"
    assert events[0]["severity"] == "medium"
    assert events[0]["metadata"]["source"] == "viewport_geometry"
    assert events[0]["participant"]["student_id"] == "2024-cs-001"


# ==================== 5. WEBSOCKET BROADCASTS EVENT ====================


def test_ws_broadcasts_browser_side_panel_event(client, ws_session_local, db_session):
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
                client, p_token, "browser_side_panel",
                client_event_id="panel-ws-1", metadata=PANEL_METADATA,
            )
        assert resp.status_code == 201

        # First broadcast: the monitoring event itself
        event_msg = ws.receive_json()
        assert event_msg["type"] == "monitoring_event"
        assert event_msg["event"]["event_type"] == "browser_side_panel"
        assert event_msg["event"]["severity"] == "medium"
        assert event_msg["event"]["metadata"]["source"] == "viewport_geometry"

        # Second broadcast: live risk update (Phase 9)
        risk_msg = ws.receive_json()
        assert risk_msg["type"] == "participant_risk_updated"
        assert risk_msg["risk_score"] == 15
        assert risk_msg["risk_level"] == "low"
        assert risk_msg["total_events"] == 1


# ==================== 6. RISK INCREASES BY BASE WEIGHT 15 ====================


def test_browser_side_panel_risk_increases_by_base_weight(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "browser_side_panel", client_event_id="panel-risk-1")

    p = get_risk(client, token, sid)
    assert p["total_events"] == 1
    assert p["risk_score"] == 15  # base weight, first occurrence at 100%
    assert p["risk_level"] == "low"
    assert p["medium_severity_events"] == 1


def test_browser_side_panel_counts_as_medium_severity(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "browser_side_panel", client_event_id="panel-sevcount-1")

    p = get_risk(client, token, sid)
    assert p["high_severity_events"] == 0
    assert p["medium_severity_events"] == 1
    assert p["low_severity_events"] == 0


# ==================== 7. DUPLICATE CLIENT_EVENT_ID DOES NOT INCREASE RISK ====================


def test_duplicate_client_event_id_does_not_increase_risk(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    client_eid = "panel-dup-1"
    resp1 = submit_event(client, p_token, "browser_side_panel", client_event_id=client_eid)
    resp2 = submit_event(client, p_token, "browser_side_panel", client_event_id=client_eid)
    resp3 = submit_event(client, p_token, "browser_side_panel", client_event_id=client_eid)

    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp3.status_code == 201
    assert resp1.json()["event_id"] == resp2.json()["event_id"] == resp3.json()["event_id"]

    p = get_risk(client, token, sid)
    assert p["total_events"] == 1
    assert p["risk_score"] == 15  # Not 24, not 28


# ==================== 8. DIMINISHING RISK BEHAVIOR REMAINS CORRECT ====================


def test_browser_side_panel_diminishing_risk(client):
    """x1=15, x2=15+9=24, x3=15+9+4.5 -> 28 (existing rounding)."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    # 1st occurrence: 15 * 1.0 = 15
    submit_event(client, p_token, "browser_side_panel", client_event_id="panel-dim-1")
    assert get_risk(client, token, sid)["risk_score"] == 15

    # 2nd occurrence: + 15 * 0.6 = 9 -> cumulative 24
    submit_event(client, p_token, "browser_side_panel", client_event_id="panel-dim-2")
    assert get_risk(client, token, sid)["risk_score"] == 24

    # 3rd occurrence: + 15 * 0.3 = 4.5 -> cumulative 28.5 -> 28
    submit_event(client, p_token, "browser_side_panel", client_event_id="panel-dim-3")
    assert get_risk(client, token, sid)["risk_score"] == 28


def test_browser_side_panel_mixes_with_other_event_types(client):
    """browser_side_panel (15) + tab_switch (10) -> 25."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "browser_side_panel", client_event_id="mix-1")
    submit_event(client, p_token, "tab_switch", client_event_id="mix-2")

    p = get_risk(client, token, sid)
    assert p["total_events"] == 2
    assert p["risk_score"] == 25


# ==================== 9. INSTRUCTOR OWNERSHIP / SECURITY ====================


def test_another_instructor_cannot_see_side_panel_events(client):
    token_a = register_and_login(client, INSTRUCTOR_A)
    token_b = register_and_login(client, INSTRUCTOR_B)
    sid_a, exam_code_a = create_session_in_status(client, token_a, "live")
    p_token, _ = get_participant_token(client, exam_code_a)

    submit_event(client, p_token, "browser_side_panel", client_event_id="panel-own-1")

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


def test_participant_token_cannot_view_events_or_risk(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    submit_event(client, p_token, "browser_side_panel", client_event_id="panel-ptoken-1")

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


# ==================== REGRESSION ====================


def test_existing_event_types_still_accepted(client):
    """All pre-existing event types must keep working after Phase 9.1."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, _ = get_participant_token(client, exam_code)

    for event_type in [
        "tab_switch",
        "fullscreen_exit",
        "window_minimized",
        "window_maximized",
        "window_restored",
        "looking_away",
        "camera_obscured",
        "phone_detected",
    ]:
        resp = submit_event(client, p_token, event_type, client_event_id=f"reg-{event_type}")
        assert resp.status_code == 201, f"Regression: {event_type} no longer accepted"
