"""Authentication tests covering all 10 required cases."""


# --- Test data ---
VALID_INSTRUCTOR = {
    "full_name": "Eng. Ahmad",
    "email": "ahmad@university.edu",
    "password": "SecurePass123!",
}


def register_instructor(client, data=None):
    """Helper: register an instructor and return response."""
    payload = data or VALID_INSTRUCTOR
    return client.post("/api/auth/register", json=payload)


def login_instructor(client, email=None, password=None):
    """Helper: login and return response."""
    return client.post(
        "/api/auth/login",
        json={
            "email": email or VALID_INSTRUCTOR["email"],
            "password": password or VALID_INSTRUCTOR["password"],
        },
    )


# --- 1. Register instructor successfully ---
def test_register_success(client):
    response = register_instructor(client)
    assert response.status_code == 201
    data = response.json()
    assert data["full_name"] == "Eng. Ahmad"
    assert data["email"] == "ahmad@university.edu"
    assert data["role"] == "instructor"
    assert "id" in data
    # Must NOT return password or hash
    assert "password" not in data
    assert "password_hash" not in data


# --- 2. Duplicate email rejected ---
def test_register_duplicate_email(client):
    register_instructor(client)
    response = register_instructor(client)
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"].lower()


# --- 3. Password stored as hash, not plaintext ---
def test_password_is_hashed(client, db_session):
    register_instructor(client)
    from app.models.user import User

    user = db_session.query(User).filter(User.email == VALID_INSTRUCTOR["email"]).first()
    assert user is not None
    assert user.password_hash != VALID_INSTRUCTOR["password"]
    assert len(user.password_hash) > 50  # bcrypt hashes are long


# --- 4. Correct login succeeds ---
def test_login_success(client):
    register_instructor(client)
    response = login_instructor(client)
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"
    assert data["expires_in"] > 0


# --- 5. Wrong password fails ---
def test_login_wrong_password(client):
    register_instructor(client)
    response = login_instructor(client, password="WrongPassword123!")
    assert response.status_code == 401
    # Generic error — must not reveal account existence
    assert "invalid" in response.json()["detail"].lower()


# --- 6. /me rejects unauthenticated requests ---
def test_me_unauthenticated(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 403  # HTTPBearer returns 403 when no token


# --- 7. /me works with valid access token ---
def test_me_with_valid_token(client):
    register_instructor(client)
    login_response = login_instructor(client)
    access_token = login_response.json()["access_token"]

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["full_name"] == "Eng. Ahmad"
    assert data["email"] == "ahmad@university.edu"
    assert data["role"] == "instructor"


# --- 8. Refresh token produces new access token ---
def test_refresh_token(client):
    register_instructor(client)
    login_response = login_instructor(client)
    refresh_token = login_response.json()["refresh_token"]

    response = client.post(
        "/api/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


# --- 9. Access token cannot be used as refresh token ---
def test_access_token_cannot_refresh(client):
    register_instructor(client)
    login_response = login_instructor(client)
    access_token = login_response.json()["access_token"]

    response = client.post(
        "/api/auth/refresh",
        json={"refresh_token": access_token},
    )
    assert response.status_code == 401


# --- 10. Invalid/expired token rejected ---
def test_invalid_token_rejected(client):
    register_instructor(client)
    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer invalid.token.here"},
    )
    assert response.status_code == 401


# --- 11. Login rate limiting (Phase 11) ---


def test_login_rate_limit_lockout(client):
    """10 failed logins -> 11th attempt returns 429 even with correct password."""
    register_instructor(client)

    for _ in range(10):
        response = login_instructor(client, password="WrongPassword123!")
        assert response.status_code == 401

    # 11th attempt — correct password, but the key is locked out
    response = login_instructor(client)
    assert response.status_code == 429
    assert "too many" in response.json()["detail"].lower()


def test_login_rate_limit_success_resets_window(client):
    """A successful login clears the failure window for that email."""
    register_instructor(client)

    # 5 failures (below the 10-failure threshold)
    for _ in range(5):
        login_instructor(client, password="WrongPassword123!")

    # Successful login resets the window
    response = login_instructor(client)
    assert response.status_code == 200

    # 5 more failures — still under the threshold, so a correct login works
    for _ in range(5):
        login_instructor(client, password="WrongPassword123!")
    response = login_instructor(client)
    assert response.status_code == 200


def test_login_rate_limit_per_email_isolation(client):
    """A different email is unaffected by another email's lockout."""
    register_instructor(client)  # ahmad@university.edu

    other = {
        "full_name": "Prof. Sara",
        "email": "sara@university.edu",
        "password": "AnotherPass456!",
    }
    register_instructor(client, other)

    # Lock out the first instructor's email
    for _ in range(10):
        login_instructor(client, password="WrongPassword123!")
    response = login_instructor(client)
    assert response.status_code == 429

    # The second instructor logs in normally
    response = login_instructor(
        client, email=other["email"], password=other["password"]
    )
    assert response.status_code == 200
