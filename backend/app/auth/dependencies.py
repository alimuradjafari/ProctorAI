from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.auth_service import AuthService

security = HTTPBearer()


def get_current_instructor(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> dict:
    """FastAPI dependency that extracts the authenticated instructor from the access token.

    Usage in route handlers:
        @router.get("/example")
        def example(instructor: dict = Depends(get_current_instructor)):
            # instructor["id"] is the authenticated instructor's ID
            ...
    """
    token = credentials.credentials
    service = AuthService(db)
    try:
        return service.get_current_instructor(token)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except PermissionError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized as an instructor",
        )
