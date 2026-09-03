from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.auth.dependencies import get_current_instructor
from app.services.monitoring_service import MonitoringService
from app.services.monitoring_event_service import MonitoringEventService
from app.schemas.monitoring import (
    MonitoringSessionCreate,
    MonitoringSessionUpdate,
    MonitoringSessionResponse,
    MonitoringSessionListResponse,
    RosterEntryCreate,
    RosterEntryResponse,
    RosterListResponse,
    RosterUploadResponse,
)
from app.schemas.monitoring_event import EventHistoryResponse, EventResponse

router = APIRouter(prefix="/monitoring-sessions")


# --- Monitoring Session CRUD ---


@router.post("", response_model=MonitoringSessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(
    request: MonitoringSessionCreate,
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """Create a new monitoring session."""
    service = MonitoringService(db)
    try:
        session = service.create_session(
            instructor_id=instructor["id"],
            title=request.title,
            course_name=request.course_name,
            join_mode=request.join_mode,
            starts_at=request.starts_at,
            ends_at=request.ends_at,
        )
        return session
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("", response_model=MonitoringSessionListResponse)
def list_sessions(
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """List all monitoring sessions for the authenticated instructor."""
    service = MonitoringService(db)
    sessions = service.list_sessions(instructor["id"])
    return {"sessions": sessions}


@router.get("/{session_id}", response_model=MonitoringSessionResponse)
def get_session(
    session_id: int,
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """Get a specific monitoring session."""
    service = MonitoringService(db)
    try:
        session = service.get_session(session_id, instructor["id"])
        return session
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")


@router.patch("/{session_id}", response_model=MonitoringSessionResponse)
def update_session(
    session_id: int,
    request: MonitoringSessionUpdate,
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """Update a monitoring session (DRAFT only)."""
    service = MonitoringService(db)
    try:
        session = service.update_session(
            session_id,
            instructor["id"],
            title=request.title,
            course_name=request.course_name,
            join_mode=request.join_mode,
            starts_at=request.starts_at,
            ends_at=request.ends_at,
        )
        return session
    except ValueError as e:
        error_msg = str(e)
        if "not found" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error_msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: int,
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """Delete a monitoring session (DRAFT or CANCELLED only)."""
    service = MonitoringService(db)
    try:
        service.delete_session(session_id, instructor["id"])
    except ValueError as e:
        error_msg = str(e)
        if "not found" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error_msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)


# --- Lifecycle Endpoints ---


@router.post("/{session_id}/prepare", response_model=MonitoringSessionResponse)
def prepare_session(
    session_id: int,
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """Transition session from DRAFT to WAITING."""
    service = MonitoringService(db)
    try:
        return service.prepare_session(session_id, instructor["id"])
    except ValueError as e:
        error_msg = str(e)
        if "not found" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error_msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)


@router.post("/{session_id}/start", response_model=MonitoringSessionResponse)
def start_session(
    session_id: int,
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """Transition session from WAITING to LIVE."""
    service = MonitoringService(db)
    try:
        return service.start_session(session_id, instructor["id"])
    except ValueError as e:
        error_msg = str(e)
        if "not found" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error_msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)


@router.post("/{session_id}/end", response_model=MonitoringSessionResponse)
def end_session(
    session_id: int,
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """Transition session from LIVE to ENDED."""
    service = MonitoringService(db)
    try:
        return service.end_session(session_id, instructor["id"])
    except ValueError as e:
        error_msg = str(e)
        if "not found" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error_msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)


@router.post("/{session_id}/cancel", response_model=MonitoringSessionResponse)
def cancel_session(
    session_id: int,
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """Transition session from DRAFT or WAITING to CANCELLED."""
    service = MonitoringService(db)
    try:
        return service.cancel_session(session_id, instructor["id"])
    except ValueError as e:
        error_msg = str(e)
        if "not found" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error_msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)


# --- Roster Endpoints ---


@router.get("/{session_id}/roster", response_model=RosterListResponse)
def list_roster(
    session_id: int,
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """List roster entries for a monitoring session."""
    service = MonitoringService(db)
    try:
        entries = service.list_roster(session_id, instructor["id"])
        return {"entries": entries}
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")


@router.post(
    "/{session_id}/roster",
    response_model=RosterEntryResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_roster_entry(
    session_id: int,
    request: RosterEntryCreate,
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """Add a student to the roster."""
    service = MonitoringService(db)
    try:
        entry = service.add_roster_entry(
            session_id, instructor["id"], request.student_id, request.student_name
        )
        return entry
    except ValueError as e:
        error_msg = str(e)
        if "not found" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error_msg)
        if "already exists" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=error_msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)


@router.delete("/{session_id}/roster/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_roster_entry(
    session_id: int,
    entry_id: int,
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """Delete a roster entry."""
    service = MonitoringService(db)
    try:
        service.delete_roster_entry(session_id, instructor["id"], entry_id)
    except ValueError as e:
        error_msg = str(e)
        if "not found" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error_msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)


@router.post("/{session_id}/roster/upload", response_model=RosterUploadResponse)
def upload_roster_csv(
    session_id: int,
    file: UploadFile = File(...),
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """Upload a CSV file to add roster entries."""
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only CSV files are supported",
        )

    try:
        content = file.file.read().decode("utf-8")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to read CSV file",
        )

    service = MonitoringService(db)
    try:
        result = service.upload_roster_csv(session_id, instructor["id"], content)
        return result
    except ValueError as e:
        error_msg = str(e)
        if "not found" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error_msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)


# --- Participants Endpoint ---


@router.get("/{session_id}/participants")
def list_participants(
    session_id: int,
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """List participants for a monitoring session (instructor-owned only)."""
    from app.services.participant_service import ParticipantService

    service = ParticipantService(db)
    try:
        participants = service.list_participants(session_id, instructor["id"])
        return {"participants": participants}
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
        )


# --- Risk Endpoint (Phase 9) ---


@router.get("/{session_id}/risk")
def get_session_risk(
    session_id: int,
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """Return risk snapshots for all participants in a monitoring session.

    - Instructor JWT required.
    - Instructor must own the monitoring session.
    - Participant tokens cannot access this endpoint.
    - Default ordering: risk_score DESC, student_name ASC.
    """
    from app.services.risk_service import RiskService

    service = RiskService(db)
    try:
        snapshots = service.get_session_risk(session_id, instructor["id"])
        return {"participants": snapshots}
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
        )


@router.get("/{session_id}/participants/{participant_session_id}/risk")
def get_participant_risk(
    session_id: int,
    participant_session_id: str,
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """Return a single participant's risk snapshot."""
    from app.services.risk_service import RiskService

    service = RiskService(db)
    try:
        snapshot = service.get_participant_risk(
            session_id, participant_session_id, instructor["id"]
        )
        return snapshot
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
        )


# --- Events Endpoint ---


@router.get("/{session_id}/events", response_model=EventHistoryResponse)
def list_events(
    session_id: int,
    limit: int = Query(default=100, ge=1, le=200),
    instructor: dict = Depends(get_current_instructor),
    db: Session = Depends(get_db),
):
    """Return recent monitoring events for an instructor-owned session.

    - Newest events first.
    - Default limit: 100, max: 200.
    - Instructor A cannot access instructor B's events.
    """
    service = MonitoringEventService(db)
    try:
        events = service.list_events(session_id, instructor["id"], limit=limit)
        return {"events": events}
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
        )
