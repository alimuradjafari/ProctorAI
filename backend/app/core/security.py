from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.core.config import get_settings


def hash_password(password: str) -> str:
    """Hash a plaintext password using bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), hashed_password.encode("utf-8")
    )


def create_access_token(user_id: int, email: str) -> str:
    """Create a short-lived JWT access token."""
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload = {
        "sub": str(user_id),
        "email": email,
        "type": "access",
        "exp": expire,
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(user_id: int) -> str:
    """Create a longer-lived JWT refresh token."""
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(
        days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS
    )
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "exp": expire,
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict | None:
    """Decode and validate a JWT token. Returns payload dict or None if invalid."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except JWTError:
        return None


class TokenError(Exception):
    """Raised when token validation fails."""
    pass


def verify_access_token(token: str) -> dict:
    """Verify an access token. Raises TokenError if invalid."""
    payload = decode_token(token)
    if payload is None:
        raise TokenError("Invalid or expired token")
    if payload.get("type") != "access":
        raise TokenError("Invalid token type")
    user_id = payload.get("sub")
    if user_id is None:
        raise TokenError("Invalid token payload")
    return payload


def verify_refresh_token(token: str) -> dict:
    """Verify a refresh token. Raises TokenError if invalid."""
    payload = decode_token(token)
    if payload is None:
        raise TokenError("Invalid or expired token")
    if payload.get("type") != "refresh":
        raise TokenError("Invalid token type")
    user_id = payload.get("sub")
    if user_id is None:
        raise TokenError("Invalid token payload")
    return payload
