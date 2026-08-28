"""Monitoring event Pydantic schemas."""

import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from app.models.monitoring_event import EventType, MAX_METADATA_BYTES


class EventSubmissionRequest(BaseModel):
    """Request schema for POST /api/participant-sessions/events.

    STRICTLY FORBIDS extra fields — server resolves:
    monitoring_session_id, participant_session_id, severity from token.
    """

    model_config = ConfigDict(extra="forbid")

    event_type: EventType
    confidence: float | None = None
    client_event_id: str | None = None
    client_occurred_at: datetime | None = None
    metadata: dict[str, Any] | None = None

    @field_validator("confidence")
    @classmethod
    def validate_confidence(cls, v: float | None) -> float | None:
        if v is not None and (v < 0.0 or v > 1.0):
            raise ValueError("confidence must be between 0.0 and 1.0")
        return v

    @model_validator(mode="after")
    def validate_metadata_size(self) -> "EventSubmissionRequest":
        if self.metadata is not None:
            serialized = json.dumps(self.metadata)
            if len(serialized.encode("utf-8")) > MAX_METADATA_BYTES:
                raise ValueError(
                    f"metadata exceeds maximum size of {MAX_METADATA_BYTES} bytes"
                )
        return self


class EventParticipantResponse(BaseModel):
    """Participant context included in event response."""

    participant_session_id: str
    student_id: str
    student_name: str


class EventResponse(BaseModel):
    """Response schema for event submission and history."""

    event_id: str
    event_type: str
    severity: str
    confidence: float | None = None
    client_event_id: str | None = None
    metadata: dict[str, Any]
    received_at: datetime
    participant: EventParticipantResponse


class EventHistoryResponse(BaseModel):
    """Response schema for GET /api/monitoring-sessions/{id}/events."""

    events: list[EventResponse]
