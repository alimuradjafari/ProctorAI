# ProctorAI — Railway Live Deployment Guide

> Railway is used for hackathon live hosting because Alibaba Cloud account
> provisioning is externally blocked. The Alibaba deployment architecture
> remains documented in [deployment.md](deployment.md) and is unaffected.

---

## 1. Architecture

```
Internet (HTTPS / WSS)
    │
    ├── https://<frontend>.up.railway.app
    │       │
    │   proctorai-frontend
    │   Vite/React static build (serve -s dist)
    │
    └── https://<backend>.up.railway.app
            │
        proctorai-backend
        FastAPI (uvicorn, 1 worker)
            │
        proctorai-mysql
        Railway managed MySQL 8.x
```

**Screen review**: WebRTC peer-to-peer (student extension ↔ instructor browser).
The Railway backend handles **signaling only** — no screen video passes through it.

**Camera detection**: all AI inference (face, phone, head orientation) runs
in the Chrome extension on the student's machine. No camera frames reach Railway.

---

## 2. Prerequisites

| Requirement | Status |
|---|---|
| GitHub repository pushed | Required |
| Railway account | Free tier or trial |
| Railway CLI | Optional — dashboard works too |
| Domain / SSL | Not needed — Railway auto-generates `*.up.railway.app` with HTTPS |

---

## 3. Infrastructure as Code (`.railway/railway.ts`)

The project uses Railway **Infrastructure as Code** (IaC) to define all
three resources in a single TypeScript file:

```
.railway/
  railway.ts          # IaC definition
  package.json        # railway npm package (types)
  .gitignore          # ignores node_modules/
```

### Setup

```bash
# 1. Install Railway CLI
#    https://docs.railway.com/cli#installing-the-cli

# 2. Authenticate
railway login

# 3. Create a new Railway project (or link existing)
railway init

# 4. Link the current directory to the project
railway link

# 5. Install IaC types
cd .railway && npm install && cd ..

# 6. Preview the deployment plan
railway config plan

# 7. Apply
railway config apply
```

---

## 4. Service Configuration

### 4.1 Backend — `proctorai-backend`

| Setting | Value |
|---|---|
| **Root directory** | `backend` |
| **Builder** | Railpack (auto-detects Python) |
| **Build command** | `pip install -r requirements.txt` |
| **Start command** | `uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1 --proxy-headers --forwarded-allow-ips '*'` |
| **Pre-deploy** | `alembic upgrade head` |
| **Healthcheck** | `/api/health` |
| **Replicas** | **1** (single-worker required) |

### 4.2 Frontend — `proctorai-frontend`

| Setting | Value |
|---|---|
| **Root directory** | `frontend` |
| **Builder** | Railpack (auto-detects Node.js) |
| **Build command** | `npm ci && npm run build` |
| **Start command** | `npx serve -s dist` |
| **Replicas** | 1 |

`serve -s` provides SPA fallback: any unknown route → `index.html`.
This ensures React Router routes (`/login`, `/dashboard`, `/sessions/:id`)
survive direct browser refresh.

### 4.3 MySQL — `proctorai-mysql`

Railway managed MySQL 8.x. Provisioned automatically by the IaC helper.

---

## 5. Environment Variables

### Backend (set in Railway service → Variables)

| Variable | Value | Source |
|---|---|---|
| `APP_ENV` | `production` | IaC |
| `LOG_LEVEL` | `INFO` | IaC |
| `DEBUG` | `false` | IaC |
| `DB_HOST` | `${{proctorai-mysql.MYSQLHOST}}` | IaC (Railway ref) |
| `DB_PORT` | `${{proctorai-mysql.MYSQLPORT}}` | IaC (Railway ref) |
| `DB_USER` | `${{proctorai-mysql.MYSQLUSER}}` | IaC (Railway ref) |
| `DB_PASSWORD` | `${{proctorai-mysql.MYSQLPASSWORD}}` | IaC (Railway ref) |
| `DB_NAME` | `${{proctorai-mysql.MYSQLDATABASE}}` | IaC (Railway ref) |
| `JWT_SECRET_KEY` | *(generate 64-char hex)* | **Dashboard — secret** |
| `CORS_ORIGINS` | `https://<FRONTEND_DOMAIN>` | Dashboard (after deploy) |
| `FRONTEND_URL` | `https://<FRONTEND_DOMAIN>` | Dashboard (after deploy) |
| `WS_URL` | `wss://<BACKEND_DOMAIN>` | Dashboard (after deploy) |
| `WEBRTC_STUN_URLS` | `stun:stun.l.google.com:19302` | IaC |
| `WEBRTC_TURN_URL` | *(empty)* | IaC |
| `WEBRTC_TURN_USERNAME` | *(empty)* | IaC |
| `WEBRTC_TURN_CREDENTIAL` | *(empty)* | IaC |

### Frontend (set in Railway service → Variables)

| Variable | Value | Source |
|---|---|---|
| `VITE_API_BASE_URL` | `https://<BACKEND_DOMAIN>` | Dashboard (before rebuild) |
| `VITE_WS_BASE_URL` | `wss://<BACKEND_DOMAIN>` | Dashboard (before rebuild) |

> **VITE_* variables are baked into the JS bundle at BUILD time.**
> If you change them, you must redeploy the frontend.

---

## 6. Deployment Steps (Manual — Railway Dashboard)

If the Railway CLI is not available, follow these dashboard steps:

### Step 1 — Create Project & MySQL

1. Go to [railway.com](https://railway.com) → **New Project**
2. Select **Deploy from GitHub repo** → choose your ProctorAI repository
3. Railway will auto-detect services. If not:
   - Click **+ New** → **MySQL** to add a managed MySQL database
   - Click **+ New** → **GitHub Repo** for the backend service
   - Click **+ New** → **GitHub Repo** for the frontend service

### Step 2 — Configure Backend Service

1. Select the backend service → **Settings**
2. **Root Directory**: `backend`
3. **Build Command**: `pip install -r requirements.txt`
4. **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1 --proxy-headers --forwarded-allow-ips '*'`
5. Go to **Variables** and add all backend env vars from §5
6. Generate `JWT_SECRET_KEY`:
   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```
   Paste the output as the value (do NOT share it).

### Step 3 — Deploy Backend

1. Railway will auto-deploy when you push or configure
2. Wait for the deployment to become healthy
3. Record the generated domain: `https://<backend-service>.up.railway.app`
4. Verify: `curl https://<backend-service>.up.railway.app/api/health`

### Step 4 — Configure Frontend Service

1. Select the frontend service → **Settings**
2. **Root Directory**: `frontend`
3. **Build Command**: `npm ci && npm run build`
4. **Start Command**: `npx serve -s dist`
5. Go to **Variables** and add:
   - `VITE_API_BASE_URL` = `https://<backend-service>.up.railway.app`
   - `VITE_WS_BASE_URL` = `wss://<backend-service>.up.railway.app`
6. Redeploy the frontend

### Step 5 — Configure CORS

1. Go back to backend service → **Variables**
2. Set `CORS_ORIGINS` = `https://<frontend-service>.up.railway.app`
3. Set `FRONTEND_URL` = `https://<frontend-service>.up.railway.app`
4. Set `WS_URL` = `wss://<backend-service>.up.railway.app`
5. Redeploy the backend

### Step 6 — Run Migrations

If the pre-deploy command (`alembic upgrade head`) did not run automatically:

```bash
# Using Railway CLI
railway run --service proctorai-backend alembic upgrade head

# Or from Railway dashboard → backend service → "Run Command"
alembic upgrade head
```

---

## 7. Database Migrations

Migrations run via Alembic before normal application use.

**Automated (IaC pre-deploy)**:
```
preDeploy: "alembic upgrade head"
```

**Manual (CLI)**:
```bash
railway run --service proctorai-backend alembic upgrade head
```

**Manual (Dashboard)**:
1. Go to backend service → Deployments → three-dot menu
2. Select "Run Command"
3. Enter: `alembic upgrade head`

> Never run `alembic downgrade` on production without a backup.

---

## 8. Single-Worker / Single-Replica Limitation

**CRITICAL**: ProctorAI backend MUST run exactly **1 worker** and **1 replica**.

Reason: WebSocket connections and screen-review state are held in process memory:
- `websocket_manager.py` — instructor WS connections
- `screen_review_manager.py` — participant screen-review sessions

Multiple workers or replicas would split this state, breaking WebSocket
sessions and screen reviews.

Railway configuration:
```
replicas: 1
--workers 1
```

Do NOT enable autoscaling to multiple replicas.

---

## 9. WebSocket Support

Railway's edge proxy natively supports WebSocket upgrades.
No additional Nginx or reverse-proxy layer is needed.

| Endpoint | Protocol | Path |
|---|---|---|
| Monitoring | `wss://` | `/ws/monitoring-sessions/{id}` |
| Screen review | `wss://` | `/ws/participant-screen-review` |

Long-lived connections are supported. Railway does not impose a hard
timeout on WebSocket connections through its proxy.

---

## 10. WebRTC Configuration

### STUN (configured)
```
WEBRTC_STUN_URLS=stun:stun.l.google.com:19302
```
Free public STUN servers handle most cross-network WebRTC connections.

### TURN (not deployed)
TURN is **not deployed** in the initial Railway setup. This means:
- Most normal network combinations (home Wi-Fi, mobile hotspot) will work
- Symmetric NAT / restrictive corporate firewalls **may fail**
- If screen review fails across networks, report ICE/connection-state
- TURN can be added later (Phase 12C)

---

## 11. Extension Production Build

The Chrome extension is NOT hosted on Railway. Build it locally targeting
the Railway backend:

```bash
cd extension

# Create .env.production
cat > .env.production << 'EOF'
VITE_API_BASE_URL=https://<BACKEND_DOMAIN>.up.railway.app
VITE_WS_BASE_URL=wss://<BACKEND_DOMAIN>.up.railway.app
VITE_PROD_API_HOST=https://<BACKEND_DOMAIN>.up.railway.app
EOF

# Build
npm run build
```

Verify `extension/dist/manifest.json` contains:
```json
{
  "host_permissions": [
    "http://localhost:8000/*",
    "http://127.0.0.1:8000/*",
    "https://<BACKEND_DOMAIN>.up.railway.app/*"
  ]
}
```

Load `extension/dist/` as an unpacked extension in Chrome.

---

## 12. Acceptance Checklist

| Check | Status |
|---|---|
| Backend HTTPS health (`/api/health`) | |
| Frontend HTTPS loads | |
| Direct route refresh works (`/dashboard`) | |
| Instructor register/login | |
| Session creation | |
| Extension joins remotely (no localhost calls) | |
| MonitoringEvents reach Railway | |
| Live WebSocket events in dashboard | |
| Risk score updates live | |
| Camera monitoring works (HTTPS = secure context) | |
| No media uploaded to Railway | |
| Screen-review WS authenticates | |
| WebRTC screen review tested | |
| MySQL persists data after backend redeploy | |
| No localhost runtime calls | |
| No secrets committed | |

---

## 13. Redeployment / Rollback

**Redeploy**: Push to the linked GitHub branch. Railway auto-deploys.

**Manual redeploy**: Railway dashboard → service → Deployments → latest →
"Redeploy".

**Rollback**: Railway dashboard → service → Deployments → select previous
deployment → "Rollback".

**Database persistence**: Railway MySQL is persistent across backend
redeployments. Data survives restarts.

**In-memory state loss**: WebSocket connections and active screen-review
sessions are lost on backend restart. This is expected (single-worker,
in-memory state).

---

## 14. Known Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| Single worker / replica | No horizontal scaling | Sufficient for hackathon demo |
| No TURN server | WebRTC may fail on symmetric NAT | STUN handles most cases |
| In-memory WS state | Lost on restart | Acceptable for demo |
| No automated backups | Manual `mysqldump` needed | Railway MySQL has basic persistence |
| No Chrome Web Store | Extension loaded unpacked | Sufficient for demo |
| VITE vars baked at build | Frontend rebuild needed for URL changes | Set vars before building |

---

## 15. Files Created / Modified for Railway

### Created
| File | Purpose |
|---|---|
| `.railway/railway.ts` | Infrastructure as Code definition |
| `.railway/package.json` | IaC TypeScript types |
| `.railway/.gitignore` | Ignore node_modules in .railway/ |
| `docs/deployment-railway.md` | This document |

### Modified
| File | Change |
|---|---|
| `frontend/package.json` | Added `serve` devDependency + `start` script |
| `.gitignore` | Added `.railway/node_modules/` |

### Not Modified
- `docs/deployment.md` — Alibaba documentation preserved unchanged
- All backend, frontend, and extension source code unchanged
- No secrets committed
