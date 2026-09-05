from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.auth_service import AuthService
from app.services.rate_limiter import login_rate_limiter
from app.auth.dependencies import get_current_instructor
from app.schemas.auth import (
    InstructorRegisterRequest,
    InstructorLoginRequest,
    TokenResponse,
    RefreshTokenRequest,
    RefreshTokenResponse,
    InstructorResponse,
)

router = APIRouter(prefix="/auth")


@router.post(
    "/register",
    response_model=InstructorResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    request: InstructorRegisterRequest,
    db: Session = Depends(get_db),
):
    """Register a new instructor account."""
    service = AuthService(db)
    try:
        result = service.register(
            full_name=request.full_name,
            email=request.email,
            password=request.password,
        )
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )


@router.post("/login", response_model=TokenResponse)
def login(
    request: InstructorLoginRequest,
    http_request: Request,
    db: Session = Depends(get_db),
):
    """Authenticate and receive access + refresh tokens."""
    # Rate-limit key: client host + lowercased email. The email component
    # keeps distinct accounts independent; per-IP keying alone is
    # unreliable behind proxies, so the host is only a tiebreaker.
    client_host = (
        http_request.client.host if http_request.client else "unknown"
    )
    rate_key = f"{client_host}:{request.email.lower()}"

    if login_rate_limiter.is_blocked(rate_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Try again later.",
        )

    service = AuthService(db)
    try:
        result = service.login(
            email=request.email,
            password=request.password,
        )
    except ValueError:
        login_rate_limiter.record_failure(rate_key)
        # Generic error — do not reveal whether account exists
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    login_rate_limiter.record_success(rate_key)
    return result


@router.post("/refresh", response_model=RefreshTokenResponse)
def refresh(
    request: RefreshTokenRequest,
    db: Session = Depends(get_db),
):
    """Exchange a valid refresh token for a new access token."""
    service = AuthService(db)
    try:
        result = service.refresh(request.refresh_token)
        return result
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )


@router.get("/me", response_model=InstructorResponse)
def get_me(instructor: dict = Depends(get_current_instructor)):
    """Get the currently authenticated instructor's profile."""
    return instructor
