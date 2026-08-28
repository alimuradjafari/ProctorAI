"""Participant session tests covering all required cases."""


# --- Test data ---
INSTRUCTOR_A = {
    "full_name": "Dr. Ahmed",
    "email": "ahmed@university.edu",
    "password": "SecurePass123!",
}

INSTRUCTOR_B = {
    "full_name": "Dr. Sara",
    "email": "sara@university.edu",
    "password": "SecurePass456!",
}

SESSION_OPEN = {
    "title": "DSA Midterm",
    "course_name": "Data Structures",
    "join_mode": "open_join",
}

SESSION_ROSTER = {
    "title": "Algorithms Final",
    "course_name": "Algorithms",
    "join_mode": "roster_required",
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


def create_and_prepare_session(client, token, session_data):
    """Create a session and move it to WAITING status."""
    resp = client.post(
        "/api/monitoring-sessions",
        json=session_data,
        headers=auth_headers(token),
    )
    sid = resp.json()["id"]
    exam_code = resp.json()["exam_code"]
    client.post(
        f"/api/monitoring-sessions/{sid}/prepare",
        headers=auth_headers(token),
    )
    return sid, exam_code


def create_and_start_session(client, token, session_data):
    """Create a session and move it to LIVE status."""
    sid, exam_code = create_and_prepare_session(client, token, session_data)
    client.post(
        f"/api/monitoring-sessions/{sid}/start",
        headers=auth_headers(token),
    )
    return sid, exam_code


def join_session(client, exam_code, student_id, student_name):
    return client.post(
        "/api/participant-sessions/join",
        json={
            "exam_code": exam_code,
            "student_id": student_id,
            "student_name": student_name,
        },
    )


def add_roster_entry(client, token, session_id, student_id, student_name):
    return client.post(
        f"/api/monitoring-sessions/{session_id}/roster",
        json={"student_id": student_id, "student_name": student_name},
        headers=auth_headers(token),
    )


# ==================== JOIN TESTS ====================


# 1. OPEN_JOIN student can join WAITING session
def test_open_join_waiting(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_OPEN)

    response = join_session(client, exam_code, "2024-CS-001", "Ali Khan")
    assert response.status_code == 200
    data = response.json()
    assert "participant_session_id" in data
    assert data["participant_session_id"].startswith("PS-")
    assert data["participant"]["student_id"] == "2024-cs-001"  # normalized
    assert data["monitoring_session"]["exam_code"] == exam_code


# 2. OPEN_JOIN student can join LIVE session
def test_open_join_live(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_start_session(client, token, SESSION_OPEN)

    response = join_session(client, exam_code, "2024-CS-001", "Ali Khan")
    assert response.status_code == 200


# 3. Cannot join DRAFT session
def test_cannot_join_draft(client):
    token = register_and_login(client, INSTRUCTOR_A)
    resp = client.post(
        "/api/monitoring-sessions",
        json=SESSION_OPEN,
        headers=auth_headers(token),
    )
    exam_code = resp.json()["exam_code"]

    response = join_session(client, exam_code, "2024-CS-001", "Ali Khan")
    assert response.status_code == 400


# 4. Cannot join ENDED session
def test_cannot_join_ended(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_start_session(client, token, SESSION_OPEN)

    # End the session
    client.post(f"/api/monitoring-sessions/{sid}/end", headers=auth_headers(token))

    response = join_session(client, exam_code, "2024-CS-001", "Ali Khan")
    assert response.status_code == 400


# 5. Cannot join CANCELLED session
def test_cannot_join_cancelled(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_OPEN)

    # Cancel the session
    client.post(f"/api/monitoring-sessions/{sid}/cancel", headers=auth_headers(token))

    response = join_session(client, exam_code, "2024-CS-001", "Ali Khan")
    assert response.status_code == 400


# 6. Unknown exam code fails
def test_unknown_exam_code(client):
    response = join_session(client, "FAKE-CODE", "2024-CS-001", "Ali Khan")
    assert response.status_code == 400


# 7. ROSTER_REQUIRED valid roster student can join
def test_roster_required_valid_student(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_ROSTER)

    add_roster_entry(client, token, sid, "2024-CS-001", "Ali Khan")

    response = join_session(client, exam_code, "2024-CS-001", "Ali Khan")
    assert response.status_code == 200
    data = response.json()
    assert data["participant"]["student_name"] == "Ali Khan"


# 8. ROSTER_REQUIRED unknown student fails
def test_roster_required_unknown_student(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_ROSTER)

    response = join_session(client, exam_code, "2024-CS-999", "Unknown Student")
    assert response.status_code == 403


# 9. ROSTER_REQUIRED wrong student name fails
def test_roster_required_wrong_name(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_ROSTER)

    add_roster_entry(client, token, sid, "2024-CS-001", "Ali Khan")

    response = join_session(client, exam_code, "2024-CS-001", "Wrong Name")
    assert response.status_code == 403


# 10. Student ID normalization works
def test_student_id_normalization(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_OPEN)

    response = join_session(client, exam_code, "  2024-CS-001  ", "Ali Khan")
    assert response.status_code == 200
    assert response.json()["participant"]["student_id"] == "2024-cs-001"


# 11. Student name normalization works
def test_student_name_normalization(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_ROSTER)

    add_roster_entry(client, token, sid, "2024-CS-001", "Ali Khan")

    # Extra whitespace in name should still match
    response = join_session(client, exam_code, "2024-CS-001", "  Ali   Khan  ")
    assert response.status_code == 200


# 12. Duplicate/rejoin does not create second ParticipantSession
def test_rejoin_no_duplicate(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_OPEN)

    resp1 = join_session(client, exam_code, "2024-CS-001", "Ali Khan")
    psid1 = resp1.json()["participant_session_id"]

    resp2 = join_session(client, exam_code, "2024-CS-001", "Ali Khan")
    psid2 = resp2.json()["participant_session_id"]

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert psid1 == psid2  # Same session reused

# 12a. OPEN_JOIN rejoin with matching normalized name reuses session
def test_open_join_rejoin_matching_normalized_name_reuses_session(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_OPEN)

    # Initial join
    resp1 = join_session(
        client,
        exam_code,
        "2024-CS-001",
        "Ali Khan",
    )

    assert resp1.status_code == 200
    psid1 = resp1.json()["participant_session_id"]

    # Same identity, but different case and whitespace
    resp2 = join_session(
        client,
        exam_code,
        "  2024-CS-001  ",
        "  ALI    KHAN  ",
    )

    assert resp2.status_code == 200

    data2 = resp2.json()

    # Existing ParticipantSession must be reused
    assert data2["participant_session_id"] == psid1

    # A participant token should still be issued
    assert data2["participant_access_token"]

    # Confirm only one participant exists
    participants_resp = client.get(
        f"/api/monitoring-sessions/{sid}/participants",
        headers=auth_headers(token),
    )

    assert participants_resp.status_code == 200
    assert len(participants_resp.json()["participants"]) == 1

# 12b. OPEN_JOIN rejoin with conflicting name is rejected
def test_open_join_rejoin_conflicting_name_rejected(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_OPEN)

    # Legitimate student joins first
    resp1 = join_session(
        client,
        exam_code,
        "2024-CS-001",
        "Ali Khan",
    )

    assert resp1.status_code == 200
    original_psid = resp1.json()["participant_session_id"]

    # Someone attempts to reuse the same student ID
    # with a different identity
    resp2 = join_session(
        client,
        exam_code,
        "2024-CS-001",
        "Different Person",
    )

    assert resp2.status_code == 403
    assert resp2.json()["detail"] == (
        "Unable to join with the provided student details."
    )

    # Confirm no second participant was created
    participants_resp = client.get(
        f"/api/monitoring-sessions/{sid}/participants",
        headers=auth_headers(token),
    )

    assert participants_resp.status_code == 200

    participants = participants_resp.json()["participants"]

    assert len(participants) == 1
    assert participants[0]["participant_session_id"] == original_psid
    assert participants[0]["student_name"] == "Ali Khan"

# 13. Same student_id can join different MonitoringSession
def test_same_student_different_sessions(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid1, code1 = create_and_prepare_session(client, token, SESSION_OPEN)
    sid2, code2 = create_and_prepare_session(client, token, SESSION_OPEN)

    resp1 = join_session(client, code1, "2024-CS-001", "Ali Khan")
    resp2 = join_session(client, code2, "2024-CS-001", "Ali Khan")

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp1.json()["participant_session_id"] != resp2.json()["participant_session_id"]


# 14. Join response contains participant_session_id
def test_join_response_has_psid(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_OPEN)

    response = join_session(client, exam_code, "2024-CS-001", "Ali Khan")
    assert response.status_code == 200
    assert "participant_session_id" in response.json()


# 15. Join response contains participant token
def test_join_response_has_token(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_OPEN)

    response = join_session(client, exam_code, "2024-CS-001", "Ali Khan")
    assert response.status_code == 200
    assert "participant_access_token" in response.json()
    assert response.json()["token_type"] == "bearer"


# 16. Participant token can call /me
def test_participant_token_me(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_OPEN)

    join_resp = join_session(client, exam_code, "2024-CS-001", "Ali Khan")
    p_token = join_resp.json()["participant_access_token"]

    me_resp = client.get(
        "/api/participant-sessions/me",
        headers=auth_headers(p_token),
    )
    assert me_resp.status_code == 200
    data = me_resp.json()
    assert data["student_id"] == "2024-cs-001"
    assert data["exam_code"] == exam_code


# 17. Instructor access token cannot call participant /me
def test_instructor_token_cannot_call_participant_me(client):
    token = register_and_login(client, INSTRUCTOR_A)

    response = client.get(
        "/api/participant-sessions/me",
        headers=auth_headers(token),
    )
    # Instructor token type is "access", not "participant"
    assert response.status_code == 401


# 18. Participant token cannot act as instructor token
def test_participant_token_cannot_act_as_instructor(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_OPEN)

    join_resp = join_session(client, exam_code, "2024-CS-001", "Ali Khan")
    p_token = join_resp.json()["participant_access_token"]

    # Try to access instructor-only endpoint
    response = client.get(
        "/api/monitoring-sessions",
        headers=auth_headers(p_token),
    )
    # Participant token type is "participant", not "access"
    assert response.status_code == 401


# 19. Instructor can list participants in own session
def test_instructor_list_participants(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_OPEN)

    join_session(client, exam_code, "2024-CS-001", "Ali Khan")
    join_session(client, exam_code, "2024-CS-002", "Sara Ahmed")

    response = client.get(
        f"/api/monitoring-sessions/{sid}/participants",
        headers=auth_headers(token),
    )
    assert response.status_code == 200
    participants = response.json()["participants"]
    assert len(participants) == 2


# 20. Instructor cannot list another instructor's participants
def test_instructor_cannot_list_others_participants(client):
    token_a = register_and_login(client, INSTRUCTOR_A)
    token_b = register_and_login(client, INSTRUCTOR_B)

    sid, exam_code = create_and_prepare_session(client, token_a, SESSION_OPEN)
    join_session(client, exam_code, "2024-CS-001", "Ali Khan")

    response = client.get(
        f"/api/monitoring-sessions/{sid}/participants",
        headers=auth_headers(token_b),
    )
    assert response.status_code == 404


# 21. Client cannot control instructor_id (join does not accept it)
def test_client_cannot_control_instructor_id(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_OPEN)

    # Try to send extra fields that should be ignored/rejected
    response = client.post(
        "/api/participant-sessions/join",
        json={
            "exam_code": exam_code,
            "student_id": "2024-CS-001",
            "student_name": "Ali Khan",
            "instructor_id": 999,
            "monitoring_session_id": 999,
        },
    )
    # Should still work (extra fields are ignored by Pydantic)
    assert response.status_code == 200
    # The participant should still be routed to the correct session
    assert response.json()["monitoring_session"]["exam_code"] == exam_code


# 22. ParticipantSession routes to correct MonitoringSession
def test_participant_routes_to_correct_session(client):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_and_prepare_session(client, token, SESSION_OPEN)

    join_resp = join_session(client, exam_code, "2024-CS-001", "Ali Khan")
    assert join_resp.status_code == 200
    assert join_resp.json()["monitoring_session"]["exam_code"] == exam_code
    assert join_resp.json()["monitoring_session"]["title"] == SESSION_OPEN["title"]


# ==================== CROSS-COMPATIBILITY ====================

# 23. Existing auth tests remain passing (covered by test_auth.py)
# 24. Existing monitoring-session tests remain passing (covered by test_monitoring.py)
