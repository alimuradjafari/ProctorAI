from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.auth.participant_dependencies import get_current_participant
from app.services.participant_service import ParticipantService
from app.services.monitoring_event_service import MonitoringEventService, broadcast_event
from app.schemas.participant import (
    JoinRequest,
    JoinResponse,
    ParticipantMeResponse,
)
from app.schemas.monitoring_event import EventSubmissionRequest, EventResponse

router = APIRouter(prefix="/participant-sessions")


@router.post("/join", response_model=JoinResponse, status_code=status.HTTP_200_OK)
def join_session(
    request: JoinRequest,
    db: Session = Depends(get_db),
):
    """Student join endpoint - not instructor-authenticated."""
    service = ParticipantService(db)
    try:
        result = service.join(
            exam_code=request.exam_code,
            student_id=request.student_id,
            student_name=request.student_name,
        )
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
        )
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(e)
        )


@router.get("/me", response_model=ParticipantMeResponse)
def get_participant_me(
    token_payload: dict = Depends(get_current_participant),
    db: Session = Depends(get_db),
):
    """Restore participant session state from participant token."""
    from app.repositories.participant_repository import ParticipantRepository

    psid = token_payload["sub"]
    repo = ParticipantRepository(db)
    participant = repo.get_participant_by_psid(psid)
    if not participant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Participant session not found",
        )

    ms = participant.monitoring_session
    return {
        "participant_session_id": participant.participant_session_id,
        "student_id": participant.student_id,
        "student_name": participant.student_name,
        "status": participant.status.value,
        "joined_at": participant.joined_at,
        "exam_code": ms.exam_code,
        "title": ms.title,
        "course_name": ms.course_name,
        "session_status": ms.status.value,
    }


@router.post("/events", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def submit_event(
    request: EventSubmissionRequest,
    token_payload: dict = Depends(get_current_participant),
    db: Session = Depends(get_db),
):
    """Participant-authenticated event submission endpoint.

    Server resolves: participant_session_id, monitoring_session_id, severity.
    Client NEVER supplies instructor_id, monitoring_session_id, or severity.
    """
    psid = token_payload["sub"]  # participant_session_id from token

    service = MonitoringEventService(db)
    try:
        result = service.submit_event(
            participant_token_psid=psid,
            event_type=request.event_type,
            confidence=request.confidence,
            client_event_id=request.client_event_id,
            client_occurred_at=request.client_occurred_at,
            metadata=request.metadata,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
        )

    # Broadcast only after successful commit (and only if not a duplicate)
    if not result.get("is_duplicate"):
        await broadcast_event(result)

    return result["event"]
