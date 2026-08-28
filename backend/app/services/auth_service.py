from sqlalchemy.orm import Session

from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    verify_access_token,
    verify_refresh_token,
    TokenError,
)
from app.repositories.auth_repository import AuthRepository
from app.core.config import get_settings


class AuthService:
    """Business logic for authentication."""

    def __init__(self, db: Session):
        self.repo = AuthRepository(db)

    def register(self, full_name: str, email: str, password: str) -> dict:
        """Register a new instructor. Returns instructor data dict."""
        normalized_email = email.strip().lower()

        # Check for duplicate
        existing = self.repo.get_user_by_email(normalized_email)
        if existing:
            raise ValueError("An account with this email already exists")

        # Create user and instructor in transaction
        try:
            password_hash = hash_password(password)
            user = self.repo.create_user(normalized_email, password_hash)
            instructor = self.repo.create_instructor(user.id, full_name.strip())
            self.repo.commit()

            return {
                "id": instructor.id,
                "full_name": instructor.full_name,
                "email": user.email,
                "role": user.role.value,
            }
        except Exception:
            self.repo.rollback()
            raise

    def login(self, email: str, password: str) -> dict:
        """Authenticate and return tokens."""
        normalized_email = email.strip().lower()

        user = self.repo.get_user_by_email(normalized_email)
        if not user or not verify_password(password, user.password_hash):
            raise ValueError("Invalid email or password")

        if not user.is_active:
            raise ValueError("Account is disabled")

        settings = get_settings()
        access_token = create_access_token(user.id, user.email)
        refresh_token = create_refresh_token(user.id)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        }

    def refresh(self, refresh_token: str) -> dict:
        """Refresh an access token using a valid refresh token."""
        try:
            payload = verify_refresh_token(refresh_token)
        except TokenError:
            raise ValueError("Invalid or expired refresh token")

        user_id = int(payload["sub"])
        user = self.repo.get_user_by_id(user_id)
        if not user or not user.is_active:
            raise ValueError("User not found or disabled")

        settings = get_settings()
        access_token = create_access_token(user.id, user.email)

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "expires_in": settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        }

    def get_current_instructor(self, access_token: str) -> dict:
        """Get the authenticated instructor from an access token."""
        try:
            payload = verify_access_token(access_token)
        except TokenError:
            raise ValueError("Invalid or expired access token")

        user_id = int(payload["sub"])
        user = self.repo.get_user_by_id(user_id)
        if not user or not user.is_active:
            raise ValueError("User not found or disabled")

        instructor = self.repo.get_instructor_by_user_id(user_id)
        if not instructor:
            raise PermissionError("User is not authorized as an instructor")

        return {
            "id": instructor.id,
            "full_name": instructor.full_name,
            "email": user.email,
            "role": user.role.value,
        }
