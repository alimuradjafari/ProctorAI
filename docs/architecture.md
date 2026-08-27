# ProctorAI Architecture

## 1. Product Boundaries

ProctorAI is an **LMS-independent exam-monitoring platform**. It provides only the monitoring and proctoring layer — it does not create exams, manage questions/answers, calculate grades, or replace any university LMS.

**ProctorAI does:**
- Monitor students during exams via browser extension
- Detect suspicious behavior using AI models (future)
- Route real-time alerts to the correct instructor
- Provide an instructor dashboard for live monitoring

**ProctorAI does NOT:**
- Create or manage exam content
- Store or grade answers
- Integrate directly with any specific LMS
- Calculate academic results

---

## 2. Student Extension Responsibilities

The Chrome Manifest V3 browser extension is the student-facing component.

**Current responsibilities:**
- Display ProctorAI branding and connection status
- Accept student identity and exam code input

**Future responsibilities:**
- Request camera/microphone permissions
- Run face detection, phone detection, and gaze tracking models (client-side)
- Detect browser-level events (tab switches, fullscreen exits)
- Publish monitoring events to the backend via authenticated channel
- Maintain a scoped monitoring session credential

**Key rule:** The extension never decides which teacher receives an alert. It publishes events to the backend; the backend routes them.

---

## 3. Backend Responsibilities

The FastAPI backend is the central authority.

**Responsibilities:**
- Authenticate instructors (JWT)
- Issue short-lived scoped credentials to extension participants
- Resolve `exam_code → MonitoringSession → Instructor`
- Create and manage Participant Sessions
- Receive monitoring events from extensions
- Route events to the correct instructor dashboard via WebSocket
- Calculate risk scores (future risk engine)
- Store events and evidence immutably
- Enforce session and instructor isolation

**Key rules:**
- Never trust client-provided `teacher_id` or `monitoring_session_id` when they can be resolved server-side
- Never allow cross-session or cross-instructor data access
- All authorization is enforced server-side

---

## 4. Instructor Dashboard Responsibilities

The React web dashboard is the instructor-facing component.

**Responsibilities:**
- Instructor authentication (login)
- Create and manage Monitoring Sessions
- View live participant list per session
- Receive real-time monitoring alerts via WebSocket
- Display evidence (screenshots, clips) for flagged events
- Show per-student risk summaries

---

## 5. Monitoring Session Model

A Monitoring Session represents one exam monitoring "room" created by an instructor.

```
Instructor
  └── MonitoringSession (MON-xxxxx)
        ├── exam_code (unique, e.g. DSA-8K7P2)
        ├── title, course_name
        ├── join_mode (OPEN_JOIN | ROSTER_REQUIRED)
        ├── status (DRAFT | WAITING | LIVE | ENDED | CANCELLED)
        ├── starts_at, ends_at
        ├── roster[] (optional)
        └── participant_sessions[]
```

---

## 6. Participant Session Model

A Participant Session represents one student's connection to a monitoring session.

```
Student (via extension)
  └── ParticipantSession (PS-xxxxx)
        ├── monitoring_session_id (FK)
        ├── student_id, student_name
        ├── status (JOINED | MONITORING | DISCONNECTED | ENDED)
        ├── joined_at, last_seen_at, ended_at
        └── events[]
```

**Relationship chain:**
```
Student → ParticipantSession → MonitoringSession → Instructor
```

---

## 7. Event Routing Flow

All monitoring events follow a strict server-routed path:

```
Extension (participant_session_id)
  → Backend API
    → Resolve MonitoringSession from ParticipantSession
    → Resolve instructor_id from MonitoringSession
    → Store event in database
    → Push event to authorized instructor WebSocket channel
      → Instructor Dashboard
```

**Example (two concurrent exams):**
```
Ali  → PS-1001 → MON-001 → Eng. Ahmad  → Eng. Ahmad's Dashboard
Bilal → PS-2001 → MON-002 → Eng. Fatima → Eng. Fatima's Dashboard
```

No cross-routing is possible by design.

---

## 8. Security Boundaries

### Authentication
- **Instructors:** JWT tokens with role claims
- **Students:** Short-lived scoped monitoring credentials issued after joining a session

### Authorization Rules
| Actor | Can Access |
|---|---|
| Instructor A | Only their own Monitoring Sessions and events |
| Instructor B | Only their own Monitoring Sessions and events |
| Participant | Only publish events for their own ParticipantSession |

### Enforcement
- `teacher_id` from client is **never** used for authorization
- `monitoring_session_id` is resolved server-side from the authenticated ParticipantSession
- All WebSocket connections are authenticated
- Instructor isolation is enforced at the repository/service layer

---

## 9. Real-Time Communication Design

### Future WebSocket Channels

| Channel | Direction | Purpose |
|---|---|---|
| Participant monitoring | Extension → Backend | Stream events, heartbeat |
| Instructor dashboard | Backend → Dashboard | Push live alerts, participant updates |

### Routing Logic
```
event received
  → lookup ParticipantSession
  → lookup MonitoringSession
  → lookup instructor_id
  → find active WebSocket for instructor_id
  → push event payload
```

Multiple instructors running concurrent sessions each have isolated WebSocket channels.

---

## 10. Future AI Integration Boundaries

AI models will run **client-side** in the browser extension (via TensorFlow.js / ONNX Runtime Web).

**Backend AI role:** None initially. The backend receives already-classified events with confidence scores — it does not run inference.

**Event types the AI layer will eventually produce:**
- `PHONE_DETECTED`
- `MULTIPLE_FACES`
- `SUSPICIOUS_OBJECT`
- `NO_FACE`
- `CAMERA_OBSCURED`
- `LOOKING_AWAY`

**Browser-level events (no AI required):**
- `FULLSCREEN_EXIT`
- `TAB_SWITCH`

The backend event contract is designed to accept any event type with severity and confidence, making AI integration additive without schema changes.
