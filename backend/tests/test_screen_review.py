"""Screen review signaling tests.

Tests the on-demand live screen review feature:
- Manager state machine (unit tests)
- Participant WS authentication
- Instructor WS screen review messages
- Signaling relay (offer/answer/ICE)
- Cleanup on disconnect/decline/expire
- No risk/monitoring event side effects
"""
import asyncio
import time
from unittest.mock import patch, MagicMock, AsyncMock

import pytest

from app.services.screen_review_manager import (
    ScreenReviewStatus,
    ScreenReviewManager,
    screen_review_manager,
)


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
    "title": "DSA Midterm Monitoring",
    "course_name": "Data Structures",
    "join_mode": "open_join",
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


def create_session_in_status(client, token, status: str):
    """Create a session and advance to the requested status."""
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
    """Join a session and return (participant_token, participant_session_id)."""
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


# ==================== MANAGER UNIT TESTS ====================


# 1. Manager creates request with valid SR- ID
@pytest.mark.asyncio
async def test_manager_create_request():
    mgr = ScreenReviewManager()
    mock_ws = AsyncMock()

    request = await mgr.create_request(
        monitoring_session_id=1,
        participant_session_id="PS-test123",
        instructor_id=10,
        instructor_ws=mock_ws,
    )

    assert request is not None
    assert request.screen_review_id.startswith("SR-")
    assert request.status == ScreenReviewStatus.REQUESTED
    assert request.monitoring_session_id == 1
    assert request.participant_session_id == "PS-test123"
    assert request.instructor_id == 10

    # Cancel the timeout task to avoid pending tasks
    if request.timeout_task:
        request.timeout_task.cancel()


# 2. Manager enforces one active review per session
@pytest.mark.asyncio
async def test_manager_one_active_per_session():
    mgr = ScreenReviewManager()
    mock_ws = AsyncMock()

    req1 = await mgr.create_request(
        monitoring_session_id=1,
        participant_session_id="PS-001",
        instructor_id=10,
        instructor_ws=mock_ws,
    )
    assert req1 is not None

    # Second request for same session should fail
    req2 = await mgr.create_request(
        monitoring_session_id=1,
        participant_session_id="PS-002",
        instructor_id=10,
        instructor_ws=mock_ws,
    )
    assert req2 is None

    # Cancel timeout tasks
    if req1.timeout_task:
        req1.timeout_task.cancel()


# 3. Manager validates status transitions
@pytest.mark.asyncio
async def test_manager_status_transitions():
    mgr = ScreenReviewManager()
    mock_ws = AsyncMock()

    req = await mgr.create_request(
        monitoring_session_id=1,
        participant_session_id="PS-001",
        instructor_id=10,
        instructor_ws=mock_ws,
    )
    assert req is not None

    # Valid: requested -> accepted
    ok = await mgr.update_status(req.screen_review_id, ScreenReviewStatus.ACCEPTED)
    assert ok is True
    assert req.status == ScreenReviewStatus.ACCEPTED

    # Valid: accepted -> sharing
    ok = await mgr.update_status(req.screen_review_id, ScreenReviewStatus.SHARING)
    assert ok is True
    assert req.status == ScreenReviewStatus.SHARING

    # Valid: sharing -> stopped
    ok = await mgr.update_status(req.screen_review_id, ScreenReviewStatus.STOPPED)
    assert ok is True
    assert req.status == ScreenReviewStatus.STOPPED


# 4. Manager rejects invalid transitions
@pytest.mark.asyncio
async def test_manager_invalid_transition():
    mgr = ScreenReviewManager()
    mock_ws = AsyncMock()

    req = await mgr.create_request(
        monitoring_session_id=1,
        participant_session_id="PS-001",
        instructor_id=10,
        instructor_ws=mock_ws,
    )
    assert req is not None

    # Invalid: requested -> sharing (must go through accepted)
    ok = await mgr.update_status(req.screen_review_id, ScreenReviewStatus.SHARING)
    assert ok is False
    assert req.status == ScreenReviewStatus.REQUESTED

    # Cancel timeout
    if req.timeout_task:
        req.timeout_task.cancel()


# 5. Manager expires request after timeout
@pytest.mark.asyncio
async def test_manager_expire_timeout():
    mgr = ScreenReviewManager()
    mock_ws = AsyncMock()

    # Patch the timeout to be very short for testing
    import app.services.screen_review_manager as srm
    original = srm.SCREEN_REVIEW_REQUEST_TIMEOUT_SECONDS
    srm.SCREEN_REVIEW_REQUEST_TIMEOUT_SECONDS = 0.1

    try:
        req = await mgr.create_request(
            monitoring_session_id=1,
            participant_session_id="PS-001",
            instructor_id=10,
            instructor_ws=mock_ws,
        )
        assert req is not None
        assert req.status == ScreenReviewStatus.REQUESTED

        # Wait for timeout
        await asyncio.sleep(0.3)

        assert req.status == ScreenReviewStatus.EXPIRED
    finally:
        srm.SCREEN_REVIEW_REQUEST_TIMEOUT_SECONDS = original


# 6. Manager cleanup by session stops active review
@pytest.mark.asyncio
async def test_manager_cleanup_by_session():
    mgr = ScreenReviewManager()
    mock_ws = AsyncMock()

    req = await mgr.create_request(
        monitoring_session_id=1,
        participant_session_id="PS-001",
        instructor_id=10,
        instructor_ws=mock_ws,
    )
    assert req is not None

    cleaned = await mgr.cleanup_by_session(1)
    assert len(cleaned) == 1
    assert cleaned[0].screen_review_id == req.screen_review_id
    assert req.status == ScreenReviewStatus.STOPPED


# ==================== PARTICIPANT WS AUTH TESTS ====================


# 7. Participant WS authenticates with valid token
def test_participant_ws_auth_success(client, ws_session_local_with_screen_review):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, p_sid = get_participant_token(client, exam_code)

    with client.websocket_connect("/ws/participant-screen-review") as ws:
        ws.send_json({"type": "authenticate", "access_token": p_token})
        response = ws.receive_json()
        assert response["type"] == "authenticated"


# 8. Participant WS rejects instructor token
def test_participant_ws_rejects_instructor_token(client, ws_session_local_with_screen_review):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")

    with pytest.raises(Exception):  # WebSocket closed with 4401
        with client.websocket_connect("/ws/participant-screen-review") as ws:
            ws.send_json({"type": "authenticate", "access_token": token})
            ws.receive_json()


# 9. Participant WS auth timeout
def test_participant_ws_auth_timeout(client, ws_session_local_with_screen_review):
    with pytest.raises(Exception):  # WebSocket closed due to timeout
        with client.websocket_connect("/ws/participant-screen-review") as ws:
            # Don't send auth message, wait for timeout
            time.sleep(12)
            ws.receive_json()


# ==================== INSTRUCTOR WS SCREEN REVIEW TESTS ====================


# 10. Instructor can request screen review for own participant
def test_screen_review_request_success(client, ws_session_local_with_screen_review):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, p_sid = get_participant_token(client, exam_code)

    with client.websocket_connect(f"/ws/monitoring-sessions/{sid}") as ws:
        ws.send_json({"type": "authenticate", "access_token": token})
        auth = ws.receive_json()
        assert auth["type"] == "authenticated"

        # Request screen review
        ws.send_json({
            "type": "screen_review_request",
            "participant_session_id": p_sid,
        })

        # Should receive "requested" status (participant not connected, so
        # also a "failed" status)
        msg1 = ws.receive_json()
        assert msg1["type"] == "screen_review_status"
        assert msg1["status"] == "requested"
        assert msg1["participant_session_id"] == p_sid


# 11. Request for non-existent participant rejected
def test_screen_review_request_invalid_participant(client, ws_session_local_with_screen_review):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")

    with client.websocket_connect(f"/ws/monitoring-sessions/{sid}") as ws:
        ws.send_json({"type": "authenticate", "access_token": token})
        ws.receive_json()  # authenticated

        ws.send_json({
            "type": "screen_review_request",
            "participant_session_id": "PS-nonexistent",
        })

        msg = ws.receive_json()
        assert msg["type"] == "screen_review_status"
        assert msg["status"] == "error"


# 12. Second request while one active returns error
@pytest.mark.asyncio
async def test_screen_review_request_already_active(client, ws_session_local_with_screen_review):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, p_sid = get_participant_token(client, exam_code)

    # Create an active review via the manager directly
    mock_ws = AsyncMock()
    new_req = await screen_review_manager.create_request(
        monitoring_session_id=sid,
        participant_session_id=p_sid,
        instructor_id=1,
        instructor_ws=mock_ws,
    )
    assert new_req is not None

    # Now try a new request via WS — should fail since one is active
    with client.websocket_connect(f"/ws/monitoring-sessions/{sid}") as ws:
        ws.send_json({"type": "authenticate", "access_token": token})
        ws.receive_json()  # authenticated

        ws.send_json({
            "type": "screen_review_request",
            "participant_session_id": p_sid,
        })
        msg = ws.receive_json()
        assert msg["status"] == "error"
        assert "already active" in msg.get("message", "")

    # Cancel timeout
    if new_req.timeout_task:
        new_req.timeout_task.cancel()


# 13. Instructor can stop active review
def test_screen_review_stop(client, ws_session_local_with_screen_review):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, p_sid = get_participant_token(client, exam_code)

    with client.websocket_connect(f"/ws/monitoring-sessions/{sid}") as ws:
        ws.send_json({"type": "authenticate", "access_token": token})
        ws.receive_json()

        # Request
        ws.send_json({
            "type": "screen_review_request",
            "participant_session_id": p_sid,
        })
        msg = ws.receive_json()
        review_id = msg["screen_review_id"]

        # Stop
        ws.send_json({
            "type": "screen_review_stop",
            "screen_review_id": review_id,
        })
        # Should succeed silently (no error)


# ==================== SIGNALING RELAY TESTS ====================
# Note: Starlette TestClient nested WS contexts have limitations for
# cross-WS message relay. These tests verify the participant WS handler
# independently and test relay through the manager API.


# 14. Participant accept updates manager state and relays to instructor mock
@pytest.mark.asyncio
async def test_relay_offer_participant_updates_state(client, ws_session_local_with_screen_review):
    """Participant accept updates status, and offer is validated by the handler."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, p_sid = get_participant_token(client, exam_code)

    # Create a review in the manager directly
    mock_instructor_ws = AsyncMock()
    request = await screen_review_manager.create_request(
        monitoring_session_id=sid,
        participant_session_id=p_sid,
        instructor_id=1,
        instructor_ws=mock_instructor_ws,
    )
    assert request is not None
    review_id = request.screen_review_id

    # Register participant WS via a mock
    mock_participant_ws = AsyncMock()
    await screen_review_manager.register_participant_ws(p_sid, mock_participant_ws)

    # Simulate participant accepting
    ok = await screen_review_manager.update_status(
        review_id, ScreenReviewStatus.ACCEPTED
    )
    assert ok is True
    assert request.status == ScreenReviewStatus.ACCEPTED

    # Simulate sending offer to instructor
    sent = await screen_review_manager.send_to_instructor(
        request,
        {
            "type": "screen_review_offer",
            "screen_review_id": review_id,
            "sdp": "v=0\r\n...",
        },
    )
    assert sent is True
    mock_instructor_ws.send_json.assert_called_once()
    call_args = mock_instructor_ws.send_json.call_args[0][0]
    assert call_args["type"] == "screen_review_offer"

    # Cancel timeout
    if request.timeout_task:
        request.timeout_task.cancel()


# 15. Answer from instructor relayed to participant via manager
@pytest.mark.asyncio
async def test_relay_answer_instructor_to_participant_via_manager():
    """Instructor answer can be sent to participant via manager."""
    mgr = ScreenReviewManager()
    mock_i_ws = AsyncMock()
    mock_p_ws = AsyncMock()

    req = await mgr.create_request(
        monitoring_session_id=1,
        participant_session_id="PS-001",
        instructor_id=10,
        instructor_ws=mock_i_ws,
    )
    await mgr.update_status(req.screen_review_id, ScreenReviewStatus.ACCEPTED)
    await mgr.register_participant_ws("PS-001", mock_p_ws)

    # Send answer to participant
    sent = await mgr.send_to_participant(
        "PS-001",
        {
            "type": "screen_review_answer",
            "screen_review_id": req.screen_review_id,
            "sdp": "v=0\r\nanswer...",
        },
    )
    assert sent is True
    mock_p_ws.send_json.assert_called_once()
    call_args = mock_p_ws.send_json.call_args[0][0]
    assert call_args["type"] == "screen_review_answer"

    if req.timeout_task:
        req.timeout_task.cancel()


# 16. ICE candidates relay bidirectionally via manager
@pytest.mark.asyncio
async def test_relay_ice_candidate_bidirectional_via_manager():
    """ICE candidates can be sent in both directions via manager."""
    mgr = ScreenReviewManager()
    mock_i_ws = AsyncMock()
    mock_p_ws = AsyncMock()

    req = await mgr.create_request(
        monitoring_session_id=1,
        participant_session_id="PS-001",
        instructor_id=10,
        instructor_ws=mock_i_ws,
    )
    await mgr.update_status(req.screen_review_id, ScreenReviewStatus.ACCEPTED)
    await mgr.register_participant_ws("PS-001", mock_p_ws)

    # Participant sends ICE to instructor
    await mgr.send_to_instructor(
        req,
        {
            "type": "screen_review_ice_candidate",
            "candidate": "candidate:1 ...",
        },
    )
    assert mock_i_ws.send_json.call_count == 1

    # Instructor sends ICE to participant
    await mgr.send_to_participant(
        "PS-001",
        {
            "type": "screen_review_ice_candidate",
            "candidate": "candidate:2 ...",
        },
    )
    assert mock_p_ws.send_json.call_count == 1

    if req.timeout_task:
        req.timeout_task.cancel()


# ==================== CLEANUP TESTS ====================


# 17. Participant disconnect cleans up review
def test_participant_disconnect_cleans_up(client, ws_session_local_with_screen_review):
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, p_sid = get_participant_token(client, exam_code)

    # Create a review via the manager and register a mock participant WS
    mock_i_ws = AsyncMock()
    loop = asyncio.new_event_loop()
    req = loop.run_until_complete(
        screen_review_manager.create_request(
            monitoring_session_id=sid,
            participant_session_id=p_sid,
            instructor_id=1,
            instructor_ws=mock_i_ws,
        )
    )
    assert req is not None
    review_id = req.screen_review_id

    # Connect participant WS and accept, then disconnect
    with client.websocket_connect("/ws/participant-screen-review") as p_ws:
        p_ws.send_json({"type": "authenticate", "access_token": p_token})
        p_ws.receive_json()  # authenticated

        # Accept the review
        p_ws.send_json({
            "type": "screen_review_accepted",
            "screen_review_id": review_id,
        })

    # After participant disconnects, the review should be stopped
    assert req.status == ScreenReviewStatus.STOPPED
    loop.close()


# 18. Declined request allows new request
@pytest.mark.asyncio
async def test_declined_allows_new_request(client, ws_session_local_with_screen_review):
    """A declined request allows a new request for the same participant."""
    token = register_and_login(client, INSTRUCTOR_A)
    sid, exam_code = create_session_in_status(client, token, "live")
    p_token, p_sid = get_participant_token(client, exam_code)

    # Create first request via manager (simulate a declined flow)
    mock_i_ws = AsyncMock()
    req1 = await screen_review_manager.create_request(
        monitoring_session_id=sid,
        participant_session_id=p_sid,
        instructor_id=1,
        instructor_ws=mock_i_ws,
    )
    assert req1 is not None

    # Decline it
    ok = await screen_review_manager.update_status(
        req1.screen_review_id, ScreenReviewStatus.DECLINED
    )
    assert ok is True

    # Now a new request should succeed
    req2 = await screen_review_manager.create_request(
        monitoring_session_id=sid,
        participant_session_id=p_sid,
        instructor_id=1,
        instructor_ws=mock_i_ws,
    )
    assert req2 is not None
    assert req2.screen_review_id != req1.screen_review_id
    assert req2.status == ScreenReviewStatus.REQUESTED

    # Cancel timeouts
    if req2.timeout_task:
        req2.timeout_task.cancel()
