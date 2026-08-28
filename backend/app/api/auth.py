from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.auth_service import AuthService
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
    db: Session = Depends(get_db),
):
    """Authenticate and receive access + refresh tokens."""
    service = AuthService(db)
    try:
        result = service.login(
            email=request.email,
            password=request.password,
        )
        return result
    except ValueError:
        # Generic error — do not reveal whether account exists
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )


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
