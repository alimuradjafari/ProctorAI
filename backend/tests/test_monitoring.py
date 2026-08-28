"""Monitoring session and roster tests covering all required cases."""
import io


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

SESSION_DATA = {
    "title": "DSA Midterm Monitoring",
    "course_name": "Data Structures",
    "join_mode": "roster_required",
}


# --- Helpers ---

def register_and_login(client, data):
    """Register and login an instructor, return access token."""
    client.post("/api/auth/register", json=data)
    response = client.post(
        "/api/auth/login",
        json={"email": data["email"], "password": data["password"]},
    )
    return response.json()["access_token"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def create_session(client, token, data=None):
    """Create a monitoring session and return response."""
    return client.post(
        "/api/monitoring-sessions",
        json=data or SESSION_DATA,
        headers=auth_headers(token),
    )


# ==================== MONITORING SESSION TESTS ====================


# --- 1. Authenticated instructor can create session ---
def test_create_session(client):
    token = register_and_login(client, INSTRUCTOR_A)
    response = create_session(client, token)
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == SESSION_DATA["title"]
    assert data["course_name"] == SESSION_DATA["course_name"]
    assert data["join_mode"] == SESSION_DATA["join_mode"]
    assert data["status"] == "draft"
    assert "exam_code" in data
    assert "id" in data


# --- 2. Generated exam code exists ---
def test_exam_code_exists(client):
    token = register_and_login(client, INSTRUCTOR_A)
    response = create_session(client, token)
    data = response.json()
    exam_code = data["exam_code"]
    assert exam_code is not None
    assert len(exam_code) >= 6
    assert "-" in exam_code  # Format like DSA-8K7P2


# --- 3. Exam code is unique ---
def test_exam_code_unique(client):
    token = register_and_login(client, INSTRUCTOR_A)
    response1 = create_session(client, token)
    response2 = create_session(client, token)
    code1 = response1.json()["exam_code"]
    code2 = response2.json()["exam_code"]
    assert code1 != code2


# --- 4. Initial status is DRAFT ---
def test_initial_status_draft(client):
    token = register_and_login(client, INSTRUCTOR_A)
    response = create_session(client, token)
    assert response.json()["status"] == "draft"


# --- 5. Instructor can list own sessions ---
def test_list_own_sessions(client):
    token = register_and_login(client, INSTRUCTOR_A)
    create_session(client, token)
    create_session(client, token)

    response = client.get("/api/monitoring-sessions", headers=auth_headers(token))
    assert response.status_code == 200
    sessions = response.json()["sessions"]
    assert len(sessions) == 2


# --- 6. Instructor cannot access another instructor's session ---
def test_cannot_access_others_session(client):
    token_a = register_and_login(client, INSTRUCTOR_A)
    token_b = register_and_login(client, INSTRUCTOR_B)

    # Create session as instructor A
    create_response = create_session(client, token_a)
    session_id = create_response.json()["id"]

    # Try to access as instructor B
    response = client.get(f"/api/monitoring-sessions/{session_id}", headers=auth_headers(token_b))
    assert response.status_code == 404


# --- 7. Instructor cannot edit another instructor's session ---
def test_cannot_edit_others_session(client):
    token_a = register_and_login(client, INSTRUCTOR_A)
    token_b = register_and_login(client, INSTRUCTOR_B)

    create_response = create_session(client, token_a)
    session_id = create_response.json()["id"]

    response = client.patch(
        f"/api/monitoring-sessions/{session_id}",
        json={"title": "Hacked Title"},
        headers=auth_headers(token_b),
    )
    assert response.status_code == 404


# --- 8. Valid lifecycle transitions work ---
def test_valid_lifecycle_transitions(client):
    token = register_and_login(client, INSTRUCTOR_A)
    create_response = create_session(client, token)
    session_id = create_response.json()["id"]

    # DRAFT -> WAITING (prepare)
    response = client.post(f"/api/monitoring-sessions/{session_id}/prepare", headers=auth_headers(token))
    assert response.status_code == 200
    assert response.json()["status"] == "waiting"

    # WAITING -> LIVE (start)
    response = client.post(f"/api/monitoring-sessions/{session_id}/start", headers=auth_headers(token))
    assert response.status_code == 200
    assert response.json()["status"] == "live"

    # LIVE -> ENDED (end)
    response = client.post(f"/api/monitoring-sessions/{session_id}/end", headers=auth_headers(token))
    assert response.status_code == 200
    assert response.json()["status"] == "ended"


# --- 9. Invalid lifecycle transitions fail ---
def test_invalid_lifecycle_transitions(client):
    token = register_and_login(client, INSTRUCTOR_A)
    create_response = create_session(client, token)
    session_id = create_response.json()["id"]

    # Cannot go directly from DRAFT to LIVE
    response = client.post(f"/api/monitoring-sessions/{session_id}/start", headers=auth_headers(token))
    assert response.status_code == 400

    # Prepare first
    client.post(f"/api/monitoring-sessions/{session_id}/prepare", headers=auth_headers(token))

    # Cannot go from WAITING to ENDED directly
    response = client.post(f"/api/monitoring-sessions/{session_id}/end", headers=auth_headers(token))
    assert response.status_code == 400


# --- 10. Unauthorized request fails ---
def test_unauthorized_request(client):
    response = client.get("/api/monitoring-sessions")
    assert response.status_code == 403  # HTTPBearer returns 403 when no token


# ==================== ROSTER TESTS ====================


# --- 11. Add student ---
def test_add_student(client):
    token = register_and_login(client, INSTRUCTOR_A)
    session_id = create_session(client, token).json()["id"]

    response = client.post(
        f"/api/monitoring-sessions/{session_id}/roster",
        json={"student_id": "2024-CS-001", "student_name": "Ali Khan"},
        headers=auth_headers(token),
    )
    assert response.status_code == 201
    data = response.json()
    assert data["student_id"] == "2024-CS-001"
    assert data["student_name"] == "Ali Khan"


# --- 12. List roster ---
def test_list_roster(client):
    token = register_and_login(client, INSTRUCTOR_A)
    session_id = create_session(client, token).json()["id"]

    client.post(
        f"/api/monitoring-sessions/{session_id}/roster",
        json={"student_id": "2024-CS-001", "student_name": "Ali Khan"},
        headers=auth_headers(token),
    )
    client.post(
        f"/api/monitoring-sessions/{session_id}/roster",
        json={"student_id": "2024-CS-002", "student_name": "Sara Ahmed"},
        headers=auth_headers(token),
    )

    response = client.get(f"/api/monitoring-sessions/{session_id}/roster", headers=auth_headers(token))
    assert response.status_code == 200
    entries = response.json()["entries"]
    assert len(entries) == 2


# --- 13. Delete student ---
def test_delete_student(client):
    token = register_and_login(client, INSTRUCTOR_A)
    session_id = create_session(client, token).json()["id"]

    add_response = client.post(
        f"/api/monitoring-sessions/{session_id}/roster",
        json={"student_id": "2024-CS-001", "student_name": "Ali Khan"},
        headers=auth_headers(token),
    )
    entry_id = add_response.json()["id"]

    delete_response = client.delete(
        f"/api/monitoring-sessions/{session_id}/roster/{entry_id}",
        headers=auth_headers(token),
    )
    assert delete_response.status_code == 204

    # Verify deleted
    list_response = client.get(f"/api/monitoring-sessions/{session_id}/roster", headers=auth_headers(token))
    assert len(list_response.json()["entries"]) == 0


# --- 14. Duplicate student_id in same session fails ---
def test_duplicate_student_same_session(client):
    token = register_and_login(client, INSTRUCTOR_A)
    session_id = create_session(client, token).json()["id"]

    client.post(
        f"/api/monitoring-sessions/{session_id}/roster",
        json={"student_id": "2024-CS-001", "student_name": "Ali Khan"},
        headers=auth_headers(token),
    )

    response = client.post(
        f"/api/monitoring-sessions/{session_id}/roster",
        json={"student_id": "2024-CS-001", "student_name": "Ali Khan Again"},
        headers=auth_headers(token),
    )
    assert response.status_code == 409


# --- 15. Same student_id in different session succeeds ---
def test_same_student_different_sessions(client):
    token = register_and_login(client, INSTRUCTOR_A)
    session1_id = create_session(client, token).json()["id"]
    session2_id = create_session(client, token).json()["id"]

    response1 = client.post(
        f"/api/monitoring-sessions/{session1_id}/roster",
        json={"student_id": "2024-CS-001", "student_name": "Ali Khan"},
        headers=auth_headers(token),
    )
    response2 = client.post(
        f"/api/monitoring-sessions/{session2_id}/roster",
        json={"student_id": "2024-CS-001", "student_name": "Ali Khan"},
        headers=auth_headers(token),
    )

    assert response1.status_code == 201
    assert response2.status_code == 201


# --- 16. Instructor cannot manage another instructor's roster ---
def test_cannot_manage_others_roster(client):
    token_a = register_and_login(client, INSTRUCTOR_A)
    token_b = register_and_login(client, INSTRUCTOR_B)

    session_id = create_session(client, token_a).json()["id"]

    response = client.post(
        f"/api/monitoring-sessions/{session_id}/roster",
        json={"student_id": "2024-CS-001", "student_name": "Ali Khan"},
        headers=auth_headers(token_b),
    )
    assert response.status_code == 404


# --- 17. Valid CSV upload works ---
def test_csv_upload_valid(client):
    token = register_and_login(client, INSTRUCTOR_A)
    session_id = create_session(client, token).json()["id"]

    csv_content = "student_id,name\n2024-CS-001,Ali Khan\n2024-CS-002,Sara Ahmed"
    files = {"file": ("roster.csv", io.BytesIO(csv_content.encode()), "text/csv")}

    response = client.post(
        f"/api/monitoring-sessions/{session_id}/roster/upload",
        files=files,
        headers=auth_headers(token),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["added"] == 2
    assert data["skipped"] == 0
    assert len(data["errors"]) == 0


# --- 18. Malformed CSV rejected ---
def test_csv_upload_malformed(client):
    token = register_and_login(client, INSTRUCTOR_A)
    session_id = create_session(client, token).json()["id"]

    # Missing required columns
    csv_content = "id,full_name\n1,Ali"
    files = {"file": ("roster.csv", io.BytesIO(csv_content.encode()), "text/csv")}

    response = client.post(
        f"/api/monitoring-sessions/{session_id}/roster/upload",
        files=files,
        headers=auth_headers(token),
    )
    assert response.status_code == 400


# --- 19. Duplicate CSV entries handled ---
def test_csv_upload_with_duplicates(client):
    token = register_and_login(client, INSTRUCTOR_A)
    session_id = create_session(client, token).json()["id"]

    # Pre-add one student
    client.post(
        f"/api/monitoring-sessions/{session_id}/roster",
        json={"student_id": "2024-CS-001", "student_name": "Ali Khan"},
        headers=auth_headers(token),
    )

    # CSV with duplicate and new entries
    csv_content = "student_id,name\n2024-CS-001,Ali Duplicate\n2024-CS-003,New Student"
    files = {"file": ("roster.csv", io.BytesIO(csv_content.encode()), "text/csv")}

    response = client.post(
        f"/api/monitoring-sessions/{session_id}/roster/upload",
        files=files,
        headers=auth_headers(token),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["added"] == 1  # Only new student
    assert data["skipped"] == 1  # Duplicate skipped


# --- Cancel transition test ---
def test_cancel_from_draft(client):
    token = register_and_login(client, INSTRUCTOR_A)
    session_id = create_session(client, token).json()["id"]

    response = client.post(f"/api/monitoring-sessions/{session_id}/cancel", headers=auth_headers(token))
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


def test_cancel_from_waiting(client):
    token = register_and_login(client, INSTRUCTOR_A)
    session_id = create_session(client, token).json()["id"]

    # First prepare
    client.post(f"/api/monitoring-sessions/{session_id}/prepare", headers=auth_headers(token))

    # Then cancel
    response = client.post(f"/api/monitoring-sessions/{session_id}/cancel", headers=auth_headers(token))
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


def test_delete_draft_session(client):
    token = register_and_login(client, INSTRUCTOR_A)
    session_id = create_session(client, token).json()["id"]

    response = client.delete(f"/api/monitoring-sessions/{session_id}", headers=auth_headers(token))
    assert response.status_code == 204


def test_delete_live_session_fails(client):
    token = register_and_login(client, INSTRUCTOR_A)
    session_id = create_session(client, token).json()["id"]

    # Move to LIVE
    client.post(f"/api/monitoring-sessions/{session_id}/prepare", headers=auth_headers(token))
    client.post(f"/api/monitoring-sessions/{session_id}/start", headers=auth_headers(token))

    # Try to delete
    response = client.delete(f"/api/monitoring-sessions/{session_id}", headers=auth_headers(token))
    assert response.status_code == 400
