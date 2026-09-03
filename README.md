# ProctorAI

**Intelligent Real-Time Exam Monitoring System**

ProctorAI is an LMS-independent exam proctoring platform. It provides the monitoring layer that sits between students taking exams and instructors supervising them — without replacing or integrating with any specific LMS.

---

## What ProctorAI Is

- A browser extension that monitors students during online exams
- A backend that receives, routes, and stores monitoring events
- A real-time instructor dashboard for live proctoring
- An extensible event-driven architecture for AI-based detection

## What ProctorAI Is NOT

- An LMS or exam platform
- A question/answer management system
- A grading or academic results system
- A replacement for university examination systems

---


## Architecture

```
Student Browser Extension
  → ProctorAI Backend (FastAPI)
    → Event / Risk Processing
      → Database (MySQL)
        → Real-Time Instructor Dashboard (React)
```

Three primary components:

| Component | Tech Stack | Purpose |
|---|---|---|
| Student Extension | Chrome MV3, TypeScript, React | Camera/browser monitoring, event publishing |
| Backend | Python 3.12, FastAPI, SQLAlchemy, MySQL | Auth, event routing, data storage |
| Instructor Dashboard | React, Vite, TypeScript, Tailwind CSS | Live monitoring UI, session management |

See [docs/architecture.md](docs/architecture.md) for the full architecture document.

---

**Phase 0 — Project Structure** (completed)


## Repository Structure

```
ProctorAI/
├── backend/          # FastAPI backend
│   ├── app/
│   │   ├── api/      # Route handlers
│   │   ├── auth/     # Authentication (future)
│   │   ├── core/     # Config, database
│   │   ├── models/   # SQLAlchemy models
│   │   ├── schemas/  # Pydantic schemas
│   │   ├── services/ # Business logic
│   │   ├── repositories/ # Data access
│   │   └── websocket/    # Real-time (future)
│   ├── alembic/      # Database migrations
│   └── tests/
├── frontend/         # React instructor dashboard
│   └── src/
│       ├── components/
│       ├── layouts/
│       ├── pages/
│       ├── services/
│       ├── types/
│       └── utils/
├── extension/        # Chrome browser extension
│   ├── public/       # Manifest, popup HTML
│   └── src/
│       ├── popup/
│       ├── background/
│       ├── content/
│       ├── services/
│       └── types/
├── docs/             # Architecture & design documentation
└── scripts/          # Development scripts
```

---

## Current Development Status

**Phase 6 — Camera + Face Presence Monitoring** (current)

This phase provides:
- Local webcam face detection using MediaPipe FaceDetector (bundled WASM + model, no CDN)
- MV3 offscreen document for camera acquisition (separate from service worker)
- Temporal persistence: `no_face` after 3s, `multiple_faces` after 2s
- Episode deduplication: one event per anomaly episode, re-arm after 2s recovery
- Startup grace period: 3s after camera+detector ready before counting anomalies
- Camera failure ≠ no_face (permission denied / hardware error handled separately)
- Session health check every 15s — auto-stop when session ends
- Explicit user consent via "Enable Camera Monitoring" button in popup
- Privacy-first: all processing local, no frames/photos/biometric data transmitted
- Service worker restart safety: camera state persisted for MV3 recovery

Previous phases:
- **Phase 5.1**: Window state monitoring (minimize/maximize/restore)
- **Phase 5**: Tab-switch + fullscreen-exit detection
- **Phase 4**: Monitoring event pipeline, WebSocket routing, real-time delivery
- **Phase 3**: Extension join flow, participant sessions, participant JWT
- **Phase 2B**: Monitoring sessions, exam codes, roster
- **Phase 2A**: Instructor authentication (JWT, login/register)
- **Phase 1**: Project foundation (FastAPI, React, Chrome extension shells)
- **Phase 0**: Architecture documentation

---

## Getting Started

### Prerequisites

- Python 3.12+
- Node.js 18+
- MySQL 8.0+

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # Linux/Mac

pip install -r requirements.txt

# Configure database in backend/.env (copy from .env.example)

# Apply database migrations
alembic upgrade head

# Run the development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Verify: `GET http://localhost:8000/api/health`

### Authentication Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register new instructor |
| POST | `/api/auth/login` | Login, returns access + refresh tokens |
| POST | `/api/auth/refresh` | Exchange refresh token for new access token |
| GET | `/api/auth/me` | Get authenticated instructor profile |

### Monitoring Session Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/monitoring-sessions` | Create new monitoring session |
| GET | `/api/monitoring-sessions` | List instructor's sessions |
| GET | `/api/monitoring-sessions/{id}` | Get session details |
| PATCH | `/api/monitoring-sessions/{id}` | Update session (DRAFT only) |
| DELETE | `/api/monitoring-sessions/{id}` | Delete session (DRAFT/CANCELLED only) |
| POST | `/api/monitoring-sessions/{id}/prepare` | DRAFT → WAITING |
| POST | `/api/monitoring-sessions/{id}/start` | WAITING → LIVE |
| POST | `/api/monitoring-sessions/{id}/end` | LIVE → ENDED |
| POST | `/api/monitoring-sessions/{id}/cancel` | DRAFT/WAITING → CANCELLED |

### Roster Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/monitoring-sessions/{id}/roster` | List roster entries |
| POST | `/api/monitoring-sessions/{id}/roster` | Add student to roster |
| DELETE | `/api/monitoring-sessions/{id}/roster/{entry_id}` | Remove student |
| POST | `/api/monitoring-sessions/{id}/roster/upload` | Upload CSV roster |

### Participant Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/participant-sessions/join` | Student join via exam code |
| GET | `/api/participant-sessions/me` | Restore participant session |
| POST | `/api/participant-sessions/events` | Submit monitoring event |

### Event Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/monitoring-sessions/{id}/events` | List session events (instructor) |

### WebSocket

| Endpoint | Description |
|---|---|
| `/ws/monitoring-sessions/{id}` | Live event stream (instructor, first-message auth) |

### Running Tests

```bash
cd backend
.venv\Scripts\pytest tests/ -v
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open: `http://localhost:5173`

### Extension

```bash
cd extension
npm install
npm run build
```

Load the extension in Chrome:
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/dist` directory

---

## Development Phases

| Phase | Focus | Status |
|---|---|---|
| 1 | Project foundation | ✅ Complete |
| 2A | Database + instructor authentication | ✅ Complete |
| 2B | Monitoring sessions + exam IDs + roster | ✅ Complete |
| 3 | Extension join flow + participant sessions | ✅ Complete |
| 4 | Real-time event routing + WebSockets | ✅ Complete |
| 5 | Browser monitoring (tab/fullscreen) | ✅ Complete |
| 5.1 | Window state monitoring (min/max/restore) | ✅ Complete |
| 6 | Camera + face detection | ✅ Current |
| 7 | Phone + object detection | Planned |
| 8 | Gaze + camera-obscured detection | Planned |
| 9 | Risk engine + evidence + alerts | Planned |
| 10 | Professional dashboard UI | Planned |
| 11 | Testing + security hardening | Planned |
| 12 | Cloud deployment | Planned |

See [docs/development-phases.md](docs/development-phases.md) for details.

---

## Documentation

- [Architecture](docs/architecture.md) — system design and boundaries
- [Data Model](docs/data-model.md) — entities and relationships
- [Development Phases](docs/development-phases.md) — roadmap

---

## License

This project is being developed for a hackathon demonstration.
