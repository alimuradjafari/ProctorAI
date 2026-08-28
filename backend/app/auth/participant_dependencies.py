from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.core.security import verify_participant_token, TokenError

participant_security = HTTPBearer(auto_error=False)


def get_current_participant(
    credentials: HTTPAuthorizationCredentials = Depends(participant_security),
) -> dict:
    """FastAPI dependency that extracts the participant from the token.

    Returns the decoded token payload containing participant_session_id in 'sub'.
    Rejects instructor tokens (type must be 'participant').
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authenticated",
        )

    token = credentials.credentials
    try:
        payload = verify_participant_token(token)
    except TokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired participant token",
        )
    return payload
