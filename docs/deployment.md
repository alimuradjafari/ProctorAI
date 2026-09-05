# ProctorAI Deployment Guide

This document covers local development setup and production readiness.
Alibaba Cloud provisioning (ECS, RDS, DNS, HTTPS, TURN) belongs to Phase 12B+.

---

## 1. Backend Environment Variables

All backend configuration is centralized in `backend/app/core/config.py`
via `pydantic-settings`. Values are loaded from environment variables
and/or `backend/.env`.

### Required Variables (production)

| Variable | Description | Example |
|---|---|---|
| `APP_ENV` | `development` or `production` | `production` |
| `DEBUG` | Enable SQLAlchemy echo logging | `false` |
| `LOG_LEVEL` | Python logging level | `INFO` |
| `DB_HOST` | MySQL host | `rm-xxx.mysql.rds.aliyuncs.com` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL user | `proctorai_app` |
| `DB_PASSWORD` | MySQL password (secret) | *(set via env, never committed)* |
| `DB_NAME` | Database name | `proctorai` |
| `JWT_SECRET_KEY` | JWT signing key — **must be 32+ random bytes** | *(set via env, never committed)* |
| `JWT_ALGORITHM` | JWT algorithm | `HS256` |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | Access token lifetime | `30` |
| `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | Refresh token lifetime | `7` |
| `CORS_ORIGINS` | Comma-separated allowed origins | `https://proctorai.example.com,chrome-extension://STORE_ID` |
| `FRONTEND_URL` | Frontend origin (for links) | `https://proctorai.example.com` |
| `WS_URL` | Backend WS URL (informational) | `wss://proctorai.example.com` |

### Optional Variables

| Variable | Description | Default |
|---|---|---|
| `DB_POOL_SIZE` | SQLAlchemy pool size | `5` |
| `DB_MAX_OVERFLOW` | SQLAlchemy max overflow | `10` |
| `DB_POOL_RECYCLE` | Connection recycle (seconds) | `1800` |
| `WEBRTC_STUN_URLS` | Comma-separated STUN URLs | *(empty)* |
| `WEBRTC_TURN_URL` | TURN server URL | *(empty)* |
| `WEBRTC_TURN_USERNAME` | TURN username | *(empty)* |
| `WEBRTC_TURN_CREDENTIAL` | TURN credential (secret) | *(empty)* |

### Local Development

Copy `backend/.env.example` to `backend/.env` and fill in dev values.
`.env` is gitignored — never commit real secrets.

```bash
cp backend/.env.example backend/.env
# Edit backend/.env with local MySQL credentials
```

---

## 2. Frontend Environment Variables

Frontend uses Vite environment variables (`VITE_*` prefix).
These are embedded in the client bundle at build time.

| Variable | Description | Development | Production |
|---|---|---|---|
| `VITE_API_BASE_URL` | Backend HTTP base (no trailing slash) | `http://localhost:8000` | `https://api.example.com` |
| `VITE_WS_BASE_URL` | Backend WS base (no trailing slash) | `ws://localhost:8000` | `wss://api.example.com` |

### Files

| File | Committed? | Purpose |
|---|---|---|
| `.env.development` | Yes | Local development defaults |
| `.env.production` | **No** (gitignored) | Real production URLs |
| `.env.production.example` | Yes | Template for production |

### Local Development

No setup needed — `.env.development` provides localhost defaults.

### Production Build

```bash
cp frontend/.env.production.example frontend/.env.production
# Edit frontend/.env.production with real production URLs
npm run build
```

**Security**: VITE_* variables are visible in the shipped JavaScript.
Never put secrets (JWT keys, DB passwords, API keys) in VITE_* vars.

---

## 3. Extension Environment Variables

Extension uses the same Vite env pattern as the frontend.

| Variable | Description | Development | Production |
|---|---|---|---|
| `VITE_API_BASE_URL` | Backend HTTP base (no trailing slash) | `http://localhost:8000` | `https://api.example.com` |
| `VITE_WS_BASE_URL` | Backend WS base (no trailing slash) | `ws://localhost:8000` | `wss://api.example.com` |
| `VITE_PROD_API_HOST` | Production host for manifest injection | *(empty)* | `https://api.example.com` |

### Files

| File | Committed? | Purpose |
|---|---|---|
| `.env.development` | Yes | Local development defaults |
| `.env.production` | **No** (gitignored) | Real production URLs |
| `.env.production.example` | Yes | Template for production |

### Manifest Host Permissions

The Chrome extension manifest requires explicit `host_permissions` for
HTTP requests. The development manifest (`extension/public/manifest.json`)
includes only localhost entries.

At production build time, the Vite plugin `manifestHostInjectionPlugin`
reads `VITE_PROD_API_HOST` from the environment and appends
`${VITE_PROD_API_HOST}/*` to the built manifest's `host_permissions`.

```bash
cp extension/.env.production.example extension/.env.production
# Edit extension/.env.production with real production URLs
VITE_PROD_API_HOST=https://api.example.com npm run build
```

### Phase 12B Checklist

1. Set `VITE_PROD_API_HOST` to the final Alibaba backend URL.
2. Build the extension in production mode.
3. Verify `dist/manifest.json` contains the production host permission.
4. Submit to Chrome Web Store.

---

## 4. CORS Configuration

CORS origins are configured via the `CORS_ORIGINS` backend env var
(comma-separated). The FastAPI CORS middleware uses this list directly.

- **Never** use `allow_origins=["*"]` with `allow_credentials=True`
  (browsers reject it).
- Development default includes `localhost:5173` and the development
  extension ID.
- Production must list the exact frontend origin and the Chrome Web
  Store extension origin (`chrome-extension://STORE_ID`).

---

## 5. Production Backend Start Command

```bash
uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  --proxy-headers \
  --forwarded-allow-ips 127.0.0.1
```

### Single-Worker Limitation

**CRITICAL**: The WebSocket connection manager and screen-review manager
hold state in-memory. Running multiple uvicorn workers would split this
state across processes, breaking WebSocket sessions and screen reviews.

The production MVP **must run a single worker** until shared state
(Redis pub/sub or similar) is introduced.

### Reverse Proxy

Production architecture: `Client → HTTPS Nginx → FastAPI`.

- `--proxy-headers` enables parsing `X-Forwarded-For` / `X-Forwarded-Proto`.
- `--forwarded-allow-ips 127.0.0.1` restricts trust to the local proxy.
  **Never** trust forwarded headers from the public Internet.

### No --reload in Production

`--reload` is for development only. It adds file-watching overhead and
can restart mid-request.

---

## 6. Database (Alembic Migrations)

Alembic reads `DATABASE_URL` from the application settings at runtime
(`alembic/env.py` overrides the placeholder in `alembic.ini`).

```bash
cd backend
# Generate a migration (if schema changed)
alembic revision --autogenerate -m "description"

# Apply migrations to production DB
alembic upgrade head
```

### Pool Settings

Production defaults are conservative and suitable for a single-worker MVP:
- `pool_pre_ping=True` — validates connections before use
- `pool_size=5` — 5 persistent connections
- `max_overflow=10` — up to 15 concurrent connections
- `pool_recycle=1800` — recycle every 30 min (avoids stale connections)

---

## 7. Health Check

Endpoint: `GET /api/health`

Returns `{"status": "healthy", "service": "ProctorAI", "version": "0.1.0"}`.
No authentication required. No secrets exposed.

Use this endpoint for:
- Alibaba Cloud SLB health checks
- Deployment verification
- Uptime monitoring

---

## 8. WebRTC / ICE Configuration

Screen review uses WebRTC peer-to-peer connections between the instructor
browser and the participant extension.

### Backend Endpoint

`GET /api/config/webrtc` returns the ICE server configuration:
```json
{ "ice_servers": [{ "urls": ["stun:stun.l.google.com:19302"] }] }
```

Both the frontend and extension fetch ICE servers from this endpoint
at screen-review initiation time.

### STUN (Phase 12A)

Set `WEBRTC_STUN_URLS` in the backend env:
```
WEBRTC_STUN_URLS=stun:stun.l.google.com:19302
```
STUN URLs are public and safe to expose.

### TURN (Phase 12C)

When deploying a TURN server:
1. Deploy coturn or a managed TURN service.
2. Set backend env vars:
   ```
   WEBRTC_TURN_URL=turn:turn.example.com:3478
   WEBRTC_TURN_USERNAME=proctorai
   WEBRTC_TURN_CREDENTIAL=<secret>
   ```
3. The `/api/config/webrtc` endpoint will include TURN in the response.
4. TURN credentials are returned to browsers (required by WebRTC).
5. Phase 12C can replace static credentials with temporary credentials
   generated from a TURN REST API secret for better security.

---

## 9. WebSocket Endpoints

Both WebSocket endpoints use the configurable backend WS base URL:

| Endpoint | Purpose |
|---|---|
| `ws(s)://<host>/ws/monitoring-sessions/{id}` | Instructor monitoring |
| `ws(s)://<host>/ws/participant-screen-review` | Screen review signaling |

Production uses `wss://` (TLS). The frontend and extension derive the
WS URL from `VITE_WS_BASE_URL`.

---

## 10. Build Commands

### Frontend

```bash
cd frontend
npm run build          # Production build (uses .env.production if present)
npx vite               # Dev server with HMR
```

### Extension

```bash
cd extension
npm run build          # Production build (uses .env.production if present)
npx vite               # Dev build (watch mode)
```

### Backend

```bash
cd backend
# Development
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Production
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --proxy-headers --forwarded-allow-ips 127.0.0.1
```

---

## 11. Secret Audit

The following are **never** committed to version control:

| Pattern | Status |
|---|---|
| `backend/.env` | Gitignored (`.gitignore`) |
| `frontend/.env.production` | Gitignored |
| `extension/.env.production` | Gitignored |
| `*.pem`, `*.key`, `*.crt` | Gitignored |
| AWS/Alibaba access keys | None found in codebase |
| JWT secrets in source code | None (loaded from env) |
| Hardcoded DB passwords | None (loaded from env) |
| Bearer tokens in source | None (only in test fixtures) |

`localhost` references are permitted in:
- `.env.development` files (committed, safe)
- Test files (fixtures, assertions)
- Documentation

Production runtime code does not depend on localhost.

---

## 12. Deferred to Phase 12B

The following are explicitly **not** part of Phase 12A:

- Alibaba ECS provisioning
- RDS MySQL provisioning
- DNS configuration
- HTTPS certificate issuance (Let's Encrypt / Alibaba SSL)
- TURN server deployment
- Chrome Web Store submission
- Production secrets in `.env.production`
- Nginx reverse proxy configuration
- Docker containerization (optional — direct ECS VM is also valid)
- Multi-worker backend (requires Redis/shared state)
