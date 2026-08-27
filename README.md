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

**Phase 1 — Project Foundation** (current)

This phase establishes the repository structure and runnable shells for all three components. It does **NOT** contain real monitoring, AI detection, or authentication features.

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

# Run the development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Verify: `GET http://localhost:8000/api/health`

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
| 1 | Project foundation | ✅ Current |
| 2 | Instructor auth + monitoring sessions | Planned |
| 3 | Extension join flow + participant sessions | Planned |
| 4 | Real-time event routing | Planned |
| 5 | Browser monitoring (tab/fullscreen) | Planned |
| 6 | Camera + face detection | Planned |
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
