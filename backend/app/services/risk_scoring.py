"""Pure server-side risk scoring engine (Phase 9).

Converts persisted MonitoringEvent rows into a participant risk score (0–100).

Design principles:
  - Risk is DERIVED from MonitoringEvent rows, not persisted.
  - Extension never submits risk values.
  - Scoring is deterministic, transparent, and testable without a database.
  - Repeated events of the same type use diminishing contribution.
  - Score is capped at 100 and rounded to an integer.

Architecture:
  MonitoringEvent rows  -->  calculate_risk_score()  -->  int (0–100)
                          -->  risk_level_for_score()  -->  RiskLevel
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Sequence


# ---------------------------------------------------------------------------
# Risk levels
# ---------------------------------------------------------------------------

class RiskLevel:
    """Shared risk-level thresholds.  Do NOT duplicate these elsewhere."""

    NORMAL = "normal"       # 0–9
    LOW = "low"             # 10–29
    MEDIUM = "medium"       # 30–49
    HIGH = "high"           # 50–74
    CRITICAL = "critical"   # 75–100


def risk_level_for_score(score: int) -> str:
    """Map an integer risk score (0–100) to a risk level string.

    Thresholds:
        0–9    -> normal
        10–29  -> low
        30–49  -> medium
        50–74  -> high
        75–100 -> critical
    """
    if score < 10:
        return RiskLevel.NORMAL
    if score < 30:
        return RiskLevel.LOW
    if score < 50:
        return RiskLevel.MEDIUM
    if score < 75:
        return RiskLevel.HIGH
    return RiskLevel.CRITICAL


# ---------------------------------------------------------------------------
# Event weights
# ---------------------------------------------------------------------------

# Base weight per event type.  Higher weight = more suspicious.
# Benign / informational events contribute 0.
EVENT_WEIGHTS: dict[str, int] = {
    "phone_detected": 30,
    "multiple_faces": 25,
    "camera_obscured": 20,
    "suspicious_object": 15,
    "no_face": 15,
    "browser_side_panel": 15,
    "exam_window_focus_lost": 15,
    "fullscreen_exit": 12,
    "window_minimized": 10,
    "tab_switch": 10,
    "looking_away": 5,
    "window_maximized": 0,
    "window_restored": 0,
}

# Diminishing-return multipliers for repeated events of the SAME type.
# 1st occurrence: 100%, 2nd: 60%, 3rd+: 30%.
DIMINISHING_FACTORS = [1.0, 0.6, 0.3]


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def calculate_risk_score(event_types: Sequence[str]) -> int:
    """Calculate a risk score from a sequence of event type strings.

    Pure function — no database, no timestamps, no side effects.

    Algorithm:
      1. Count occurrences of each event type.
      2. For each event type, apply diminishing contribution:
         - 1st: 100% of base weight
         - 2nd: 60% of base weight
         - 3rd+: 30% of base weight each
      3. Sum all contributions.
      4. Cap at 100 and round to integer.

    Args:
        event_types: Iterable of event_type string values (e.g. "phone_detected").

    Returns:
        Integer risk score in range [0, 100].
    """
    counts = Counter(event_types)
    total = 0.0

    for event_type, count in counts.items():
        base_weight = EVENT_WEIGHTS.get(event_type, 0)
        if base_weight == 0:
            continue

        for i in range(count):
            if i < len(DIMINISHING_FACTORS):
                factor = DIMINISHING_FACTORS[i]
            else:
                factor = DIMINISHING_FACTORS[-1]

            total += base_weight * factor

    return min(100, round(total))


# ---------------------------------------------------------------------------
# Snapshot dataclass
# ---------------------------------------------------------------------------


@dataclass
class EventTypeCount:
    """A single event-type count for top_event_types."""
    event_type: str
    count: int


@dataclass
class ParticipantRiskSnapshot:
    """Instructor-facing risk snapshot for one participant."""
    participant_session_id: str
    student_id: str
    student_name: str
    risk_score: int
    risk_level: str
    total_events: int
    high_severity_events: int
    medium_severity_events: int
    low_severity_events: int
    recent_event_count: int
    top_event_types: list[EventTypeCount] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "participant_session_id": self.participant_session_id,
            "student_id": self.student_id,
            "student_name": self.student_name,
            "risk_score": self.risk_score,
            "risk_level": self.risk_level,
            "total_events": self.total_events,
            "high_severity_events": self.high_severity_events,
            "medium_severity_events": self.medium_severity_events,
            "low_severity_events": self.low_severity_events,
            "recent_event_count": self.recent_event_count,
            "top_event_types": [
                {"event_type": ec.event_type, "count": ec.count}
                for ec in self.top_event_types
            ],
        }


def compute_snapshot(
    participant_session_id: str,
    student_id: str,
    student_name: str,
    events: list[dict],
    recent_window_minutes: int = 5,
) -> ParticipantRiskSnapshot:
    """Compute a full risk snapshot from a list of event dicts.

    Each event dict must have keys:
        - event_type: str
        - severity: str ("low" | "medium" | "high")
        - received_at: datetime or ISO string

    Args:
        participant_session_id: Opaque PS-... identifier.
        student_id: Student identifier.
        student_name: Display name.
        events: List of event dicts (already filtered to this participant).
        recent_window_minutes: Window for recent_event_count.

    Returns:
        ParticipantRiskSnapshot with computed score, level, and counts.
    """
    from datetime import datetime, timezone, timedelta

    event_types = [e["event_type"] for e in events]
    risk_score = calculate_risk_score(event_types)

    # Severity counts
    high = sum(1 for e in events if e["severity"] == "high")
    medium = sum(1 for e in events if e["severity"] == "medium")
    low = sum(1 for e in events if e["severity"] == "low")

    # Recent events (last N minutes)
    recent_count = 0
    if events:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(minutes=recent_window_minutes)

        for e in events:
            received = e.get("received_at")
            if received is None:
                continue

            if isinstance(received, str):
                try:
                    received = datetime.fromisoformat(received)
                except ValueError:
                    continue

            # Ensure timezone-aware
            if received.tzinfo is None:
                received = received.replace(tzinfo=timezone.utc)

            if received >= cutoff:
                recent_count += 1

    # Top event types (top 3 by count)
    type_counts = Counter(event_types)
    # Filter out zero-weight events from top types
    type_counts = {k: v for k, v in type_counts.items() if EVENT_WEIGHTS.get(k, 0) > 0}
    top = sorted(type_counts.items(), key=lambda x: (-x[1], x[0]))[:3]
    top_event_types = [EventTypeCount(event_type=t, count=c) for t, c in top]

    return ParticipantRiskSnapshot(
        participant_session_id=participant_session_id,
        student_id=student_id,
        student_name=student_name,
        risk_score=risk_score,
        risk_level=risk_level_for_score(risk_score),
        total_events=len(events),
        high_severity_events=high,
        medium_severity_events=medium,
        low_severity_events=low,
        recent_event_count=recent_count,
        top_event_types=top_event_types,
    )
