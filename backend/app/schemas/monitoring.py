from datetime import datetime
from pydantic import BaseModel, Field


# --- Monitoring Session Schemas ---

class MonitoringSessionCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    course_name: str | None = Field(None, max_length=300)
    join_mode: str = Field("open_join")  # open_join or roster_required
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class MonitoringSessionUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    course_name: str | None = Field(None, max_length=300)
    join_mode: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class MonitoringSessionResponse(BaseModel):
    id: int
    exam_code: str
    title: str
    course_name: str | None
    instructor_id: int
    join_mode: str
    status: str
    starts_at: datetime | None
    ends_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MonitoringSessionListResponse(BaseModel):
    sessions: list[MonitoringSessionResponse]


# --- Roster Schemas ---

class RosterEntryCreate(BaseModel):
    student_id: str = Field(..., min_length=1, max_length=100)
    student_name: str = Field(..., min_length=1, max_length=200)


class RosterEntryResponse(BaseModel):
    id: int
    monitoring_session_id: int
    student_id: str
    student_name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class RosterListResponse(BaseModel):
    entries: list[RosterEntryResponse]


class RosterUploadResponse(BaseModel):
    added: int
    skipped: int
    errors: list[str]
