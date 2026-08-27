# ProctorAI Development Phases

## Phase 1 — Project Foundation ✅ CURRENT

- FastAPI backend skeleton with health endpoint
- React + Vite + TypeScript + Tailwind frontend shell
- Chrome Manifest V3 extension shell
- Repository structure, environment configuration, documentation

## Phase 2 — Instructor Authentication + Monitoring Sessions + Roster

- Instructor registration and JWT login
- Monitoring Session CRUD API
- Exam code generation
- Roster upload and `ROSTER_REQUIRED` join mode enforcement
- Dashboard login page and session creation UI

## Phase 3 — Extension Student Join + Participant Session

- Extension join flow (student ID, name, exam code)
- Backend exam code resolution: `exam_code → MonitoringSession → Instructor`
- Participant Session creation and lifecycle
- Short-lived scoped monitoring credential issuance
- Extension status transitions

## Phase 4 — Real-Time Event Routing

- WebSocket infrastructure (backend + dashboard + extension)
- Event ingestion API (authenticated by participant credential)
- Server-side routing: `event → ParticipantSession → MonitoringSession → instructor WebSocket`
- Session isolation enforcement
- Dashboard live event feed

## Phase 5 — Browser Monitoring

- `TAB_SWITCH` detection via content scripts / visibility API
- `FULLSCREEN_EXIT` detection
- Event publishing pipeline from extension to backend

## Phase 6 — Camera + Face Monitoring

- Camera permission and stream access
- Client-side face detection (TensorFlow.js / BlazeFace)
- `NO_FACE` and `MULTIPLE_FACES` event generation
- Evidence capture (snapshot on event)

## Phase 7 — Phone + Suspicious Object Detection

- Client-side object detection model (COCO-SSD or similar)
- `PHONE_DETECTED` event generation
- `SUSPICIOUS_OBJECT` event generation
- Confidence threshold tuning

## Phase 8 — Looking Away + Camera Obscured Detection

- Gaze estimation or head pose tracking
- `LOOKING_AWAY` event generation with persistence logic
- `CAMERA_OBSCURED` detection (frozen/dark/covered frame)
- Duration-based event triggering

## Phase 9 — Risk Engine + Evidence + Alerts

- Risk scoring algorithm (severity + confidence + frequency + persistence)
- `RiskState` computation and storage
- Evidence management (storage, retrieval, lifecycle)
- Alert escalation thresholds
- Dashboard risk display and alert UI

## Phase 10 — Professional Instructor Dashboard

- Polished session management UI
- Live participant grid with risk indicators
- Event timeline with evidence previews
- Session history and reporting
- Exportable session summaries

## Phase 11 — Testing + Security Hardening

- Unit and integration test coverage
- End-to-end test scenarios
- Security audit (auth, isolation, input validation)
- Rate limiting and abuse prevention
- Performance benchmarking

## Phase 12 — Alibaba Cloud + Deployment

- MySQL on Alibaba Cloud RDS
- Object Storage Service (OSS) for evidence files
- ECS / ACK deployment
- CI/CD pipeline
- Production environment configuration
