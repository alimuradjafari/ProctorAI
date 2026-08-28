from datetime import datetime
from pydantic import BaseModel, Field


# --- Join Request/Response ---

class JoinRequest(BaseModel):
    exam_code: str = Field(..., min_length=1, max_length=20)
    student_id: str = Field(..., min_length=1, max_length=100)
    student_name: str = Field(..., min_length=1, max_length=200)


class ParticipantInfo(BaseModel):
    student_id: str
    student_name: str
    status: str
    joined_at: datetime

    model_config = {"from_attributes": True}


class MonitoringSessionInfo(BaseModel):
    exam_code: str
    title: str
    course_name: str | None
    status: str
    join_mode: str

    model_config = {"from_attributes": True}


class JoinResponse(BaseModel):
    participant_session_id: str
    participant_access_token: str
    token_type: str = "bearer"
    participant: ParticipantInfo
    monitoring_session: MonitoringSessionInfo


# --- Participant Me Response ---

class ParticipantMeResponse(BaseModel):
    participant_session_id: str
    student_id: str
    student_name: str
    status: str
    joined_at: datetime
    exam_code: str
    title: str
    course_name: str | None
    session_status: str


# --- Instructor Participant List ---

class ParticipantListEntry(BaseModel):
    participant_session_id: str
    student_id: str
    student_name: str
    status: str
    joined_at: datetime
    last_seen_at: datetime | None

    model_config = {"from_attributes": True}


class ParticipantListResponse(BaseModel):
    participants: list[ParticipantListEntry]
