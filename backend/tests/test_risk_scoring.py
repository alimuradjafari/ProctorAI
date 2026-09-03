"""Phase 9 tests: Pure risk scoring engine (no database)."""

import pytest

from app.services.risk_scoring import (
    calculate_risk_score,
    risk_level_for_score,
    compute_snapshot,
    RiskLevel,
    EVENT_WEIGHTS,
    DIMINISHING_FACTORS,
)


# ---------------------------------------------------------------------------
# calculate_risk_score
# ---------------------------------------------------------------------------


class TestCalculateRiskScore:
    def test_no_events_score_zero(self):
        assert calculate_risk_score([]) == 0

    def test_one_looking_away(self):
        assert calculate_risk_score(["looking_away"]) == 5

    def test_one_tab_switch(self):
        assert calculate_risk_score(["tab_switch"]) == 10

    def test_one_phone_detected(self):
        assert calculate_risk_score(["phone_detected"]) == 30

    def test_phone_plus_multiple_faces(self):
        # 30 + 25 = 55
        assert calculate_risk_score(["phone_detected", "multiple_faces"]) == 55

    def test_repeated_same_event_diminishing(self):
        # phone x3: 30*1.0 + 30*0.6 + 30*0.3 = 30 + 18 + 9 = 57
        assert calculate_risk_score(["phone_detected"] * 3) == 57

    def test_score_capped_at_100(self):
        # phone x10: 30 + 18 + 9*8 = 30 + 18 + 72 = 120 -> capped at 100
        assert calculate_risk_score(["phone_detected"] * 10) == 100

    def test_window_maximized_contributes_zero(self):
        assert calculate_risk_score(["window_maximized"]) == 0
        assert calculate_risk_score(["window_maximized"] * 100) == 0

    def test_window_restored_contributes_zero(self):
        assert calculate_risk_score(["window_restored"]) == 0

    def test_mixed_events(self):
        # phone x1 (30) + tab_switch x2 (10 + 6 = 16) + looking_away x1 (5) = 51
        events = ["phone_detected", "tab_switch", "tab_switch", "looking_away"]
        assert calculate_risk_score(events) == 51

    def test_unknown_event_type_contributes_zero(self):
        assert calculate_risk_score(["unknown_type"]) == 0

    def test_all_event_types(self):
        """Every non-zero weight event type contributes correctly."""
        events = [
            "phone_detected",      # 30
            "multiple_faces",      # 25
            "camera_obscured",     # 20
            "suspicious_object",   # 15
            "no_face",             # 15
            "fullscreen_exit",     # 12
            "window_minimized",    # 10
            "tab_switch",          # 10
            "looking_away",        # 5
        ]
        # 30+25+20+15+15+12+10+10+5 = 142 -> capped at 100
        assert calculate_risk_score(events) == 100


# ---------------------------------------------------------------------------
# risk_level_for_score
# ---------------------------------------------------------------------------


class TestRiskLevelForScore:
    @pytest.mark.parametrize(
        "score, expected",
        [
            (0, "normal"),
            (9, "normal"),
            (10, "low"),
            (29, "low"),
            (30, "medium"),
            (49, "medium"),
            (50, "high"),
            (74, "high"),
            (75, "critical"),
            (100, "critical"),
        ],
    )
    def test_boundary_values(self, score, expected):
        assert risk_level_for_score(score) == expected


# ---------------------------------------------------------------------------
# compute_snapshot
# ---------------------------------------------------------------------------


class TestComputeSnapshot:
    def _make_event(self, event_type: str, severity: str = "medium"):
        from datetime import datetime, timezone

        return {
            "event_type": event_type,
            "severity": severity,
            "received_at": datetime.now(timezone.utc),
        }

    def test_no_events(self):
        snap = compute_snapshot("PS-1", "s1", "Alice", [])
        assert snap.risk_score == 0
        assert snap.risk_level == "normal"
        assert snap.total_events == 0
        assert snap.top_event_types == []

    def test_severity_counts(self):
        events = [
            self._make_event("phone_detected", "high"),
            self._make_event("phone_detected", "high"),
            self._make_event("tab_switch", "medium"),
            self._make_event("looking_away", "low"),
        ]
        snap = compute_snapshot("PS-1", "s1", "Alice", events)
        assert snap.high_severity_events == 2
        assert snap.medium_severity_events == 1
        assert snap.low_severity_events == 1
        assert snap.total_events == 4

    def test_top_event_types_limit(self):
        events = [
            self._make_event("phone_detected"),
            self._make_event("phone_detected"),
            self._make_event("tab_switch"),
            self._make_event("tab_switch"),
            self._make_event("tab_switch"),
            self._make_event("looking_away"),
            self._make_event("looking_away"),
            self._make_event("no_face"),
        ]
        snap = compute_snapshot("PS-1", "s1", "Alice", events)
        # Top 3: tab_switch(3), phone_detected(2), looking_away(2)
        assert len(snap.top_event_types) == 3
        assert snap.top_event_types[0].event_type == "tab_switch"
        assert snap.top_event_types[0].count == 3

    def test_top_event_types_excludes_zero_weight(self):
        events = [
            self._make_event("phone_detected"),
            self._make_event("window_maximized"),
            self._make_event("window_maximized"),
            self._make_event("window_restored"),
        ]
        snap = compute_snapshot("PS-1", "s1", "Alice", events)
        # Only phone_detected should appear in top types
        assert len(snap.top_event_types) == 1
        assert snap.top_event_types[0].event_type == "phone_detected"

    def test_to_dict(self):
        events = [self._make_event("phone_detected", "high")]
        snap = compute_snapshot("PS-ABC", "s1", "Alice", events)
        d = snap.to_dict()
        assert d["participant_session_id"] == "PS-ABC"
        assert d["student_name"] == "Alice"
        assert d["risk_score"] == 30
        assert d["risk_level"] == "medium"
        assert isinstance(d["top_event_types"], list)
        assert d["top_event_types"][0]["event_type"] == "phone_detected"
        assert d["top_event_types"][0]["count"] == 1

    def test_recent_event_count(self):
        from datetime import datetime, timezone, timedelta

        now = datetime.now(timezone.utc)
        events = [
            {"event_type": "phone_detected", "severity": "high", "received_at": now},
            {"event_type": "tab_switch", "severity": "medium", "received_at": now},
            # Old event — outside 5-minute window
            {
                "event_type": "looking_away",
                "severity": "low",
                "received_at": now - timedelta(minutes=10),
            },
        ]
        snap = compute_snapshot("PS-1", "s1", "Alice", events, recent_window_minutes=5)
        assert snap.recent_event_count == 2
