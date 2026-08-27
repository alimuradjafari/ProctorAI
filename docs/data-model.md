# ProctorAI Data Model

## Entity Relationship Overview

```
User (1) ──< (1) Instructor
Instructor (1) ──< (N) MonitoringSession
MonitoringSession (1) ──< (N) StudentRosterEntry
MonitoringSession (1) ──< (N) ParticipantSession
ParticipantSession (1) ──< (N) MonitoringEvent
MonitoringEvent (1) ──< (0..1) Evidence
ParticipantSession (1) ──< (0..1) RiskState
```

---

## User

System-level authentication identity.

| Field | Type | Constraints |
|---|---|---|
| id | UUID / INT | PK |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| password_hash | VARCHAR(255) | NOT NULL |
| role | ENUM | `INSTRUCTOR`, `ADMIN` (future) |
| is_active | BOOLEAN | DEFAULT TRUE |
| created_at | DATETIME | AUTO |
| updated_at | DATETIME | AUTO |

---

## Instructor

Instructor profile linked 1:1 to a User.

| Field | Type | Constraints |
|---|---|---|
| id | UUID / INT | PK |
| user_id | UUID / INT | FK → User.id, UNIQUE |
| full_name | VARCHAR(200) | NOT NULL |
| department | VARCHAR(200) | OPTIONAL |
| created_at | DATETIME | AUTO |

---

## MonitoringSession

One exam monitoring room created by an instructor.

| Field | Type | Constraints |
|---|---|---|
| id | UUID / INT | PK |
| exam_code | VARCHAR(20) | UNIQUE, NOT NULL, INDEX |
| title | VARCHAR(300) | NOT NULL |
| course_name | VARCHAR(300) | OPTIONAL |
| instructor_id | UUID / INT | FK → Instructor.id, INDEX |
| join_mode | ENUM | `OPEN_JOIN`, `ROSTER_REQUIRED` |
| status | ENUM | `DRAFT`, `WAITING`, `LIVE`, `ENDED`, `CANCELLED` |
| starts_at | DATETIME | OPTIONAL |
| ends_at | DATETIME | OPTIONAL |
| created_at | DATETIME | AUTO |
| updated_at | DATETIME | AUTO |

**Constraints:**
- `exam_code` must be globally unique
- `instructor_id` is a required FK

---

## StudentRosterEntry

A student authorized to join a specific monitoring session (used when `join_mode = ROSTER_REQUIRED`).

| Field | Type | Constraints |
|---|---|---|
| id | UUID / INT | PK |
| monitoring_session_id | UUID / INT | FK → MonitoringSession.id, INDEX |
| student_id | VARCHAR(100) | NOT NULL |
| student_name | VARCHAR(200) | NOT NULL |
| created_at | DATETIME | AUTO |

**Constraints:**
- Unique together: `(monitoring_session_id, student_id)`

---

## ParticipantSession

One student's active monitoring connection.

| Field | Type | Constraints |
|---|---|---|
| id | UUID / INT | PK |
| monitoring_session_id | UUID / INT | FK → MonitoringSession.id, INDEX |
| student_id | VARCHAR(100) | NOT NULL, INDEX |
| student_name | VARCHAR(200) | NOT NULL |
| status | ENUM | `JOINED`, `MONITORING`, `DISCONNECTED`, `ENDED` |
| joined_at | DATETIME | NOT NULL |
| last_seen_at | DATETIME | AUTO |
| ended_at | DATETIME | OPTIONAL |

**Constraints:**
- Exactly one MonitoringSession per ParticipantSession
- A student may have multiple ParticipantSessions across different MonitoringSessions

---

## MonitoringEvent

A single detected suspicious activity.

| Field | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| participant_session_id | UUID / INT | FK → ParticipantSession.id, INDEX |
| monitoring_session_id | UUID / INT | FK → MonitoringSession.id, INDEX |
| event_type | ENUM | See event types below |
| severity | ENUM | `LOW`, `MEDIUM`, `HIGH` |
| confidence | FLOAT | 0.0–1.0 |
| occurred_at | DATETIME | NOT NULL |
| duration_seconds | FLOAT | OPTIONAL |
| metadata | JSON | OPTIONAL |
| evidence_id | UUID / INT | FK → Evidence.id, OPTIONAL |
| created_at | DATETIME | AUTO |

**Event types:**
- `PHONE_DETECTED`
- `MULTIPLE_FACES`
- `SUSPICIOUS_OBJECT`
- `NO_FACE`
- `FULLSCREEN_EXIT`
- `TAB_SWITCH`
- `CAMERA_OBSCURED`
- `LOOKING_AWAY`

---

## Evidence

Captured media or snapshot related to a monitoring event.

| Field | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| participant_session_id | UUID / INT | FK → ParticipantSession.id |
| storage_path | VARCHAR(500) | NOT NULL |
| media_type | ENUM | `IMAGE`, `VIDEO_CLIP`, `AUDIO_CLIP` |
| captured_at | DATETIME | NOT NULL |
| created_at | DATETIME | AUTO |

---

## RiskState

Current calculated risk level for a participant (maintained by the future risk engine).

| Field | Type | Constraints |
|---|---|---|
| id | UUID / INT | PK |
| participant_session_id | UUID / INT | FK → ParticipantSession.id, UNIQUE |
| current_risk | ENUM | `LOW`, `MEDIUM`, `HIGH` |
| event_count | INT | DEFAULT 0 |
| last_event_at | DATETIME | OPTIONAL |
| updated_at | DATETIME | AUTO |

---

## Key Indexes

| Table | Indexed Fields |
|---|---|
| MonitoringSession | `exam_code`, `instructor_id`, `status` |
| ParticipantSession | `monitoring_session_id`, `student_id`, `status` |
| MonitoringEvent | `participant_session_id`, `monitoring_session_id`, `event_type` |
| StudentRosterEntry | `monitoring_session_id`, `(monitoring_session_id, student_id)` UNIQUE |

---

## Design Notes

- `monitoring_session_id` on `MonitoringEvent` is denormalized for query performance; it is always resolved server-side from the ParticipantSession.
- `evidence_id` on `MonitoringEvent` is optional — some events (e.g. `TAB_SWITCH`) may not have attached media.
- `metadata` JSON field on `MonitoringEvent` allows event-type-specific payload extension without schema migration.
- `RiskState` is maintained as a separate table rather than computed on the fly, enabling fast dashboard reads.
