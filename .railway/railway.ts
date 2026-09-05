/**
 * ProctorAI — Railway Infrastructure as Code
 *
 * Defines the complete Railway project for the hackathon live demo:
 *   - Backend (FastAPI, single worker, WebSocket + WebRTC signaling)
 *   - Frontend (Vite/React static build served by `serve`)
 *   - Railway managed MySQL database
 *
 * Prerequisites:
 *   1. Install Railway CLI: https://docs.railway.com/cli
 *   2. railway login
 *   3. railway link  (connect to your Railway project)
 *   4. npm install   (in .railway/ — installs IaC types)
 *
 * Deploy:
 *   railway config plan
 *   railway config apply
 *
 * IMPORTANT:
 *   - Backend MUST run exactly 1 replica (in-memory WebSocket state).
 *   - Secrets (JWT_SECRET_KEY) are preserve()d — set via Railway dashboard.
 *   - After the frontend domain is generated, update backend CORS_ORIGINS
 *     and FRONTEND_URL in Railway environment variables.
 */
import { defineRailway, group, mysql, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  // ── Database ────────────────────────────────────────────────────────
  const db = mysql("proctorai-mysql");

  // ── Backend — FastAPI (Python) ─────────────────────────────────────
  const backend = service("proctorai-backend", {
    // rootDirectory is set via Railway dashboard → Service Settings → Source
    // because the GitHub repo link is managed per-project.
    build: "pip install -r requirements.txt",
    start: "uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1 --proxy-headers --forwarded-allow-ips '*'",
    preDeploy: "alembic upgrade head",
    healthcheck: "/api/health",
    replicas: 1, // CRITICAL: single replica (in-memory WS state)
    env: {
      APP_ENV: "production",
      LOG_LEVEL: "INFO",
      DEBUG: "false",

      // Map Railway MySQL variables → ProctorAI DB_* fields
      DB_HOST: "${{proctorai-mysql.MYSQLHOST}}",
      DB_PORT: "${{proctorai-mysql.MYSQLPORT}}",
      DB_USER: "${{proctorai-mysql.MYSQLUSER}}",
      DB_PASSWORD: "${{proctorai-mysql.MYSQLPASSWORD}}",
      DB_NAME: "${{proctorai-mysql.MYSQLDATABASE}}",

      // Secrets — managed in Railway dashboard, never committed
      JWT_SECRET_KEY: preserve(),

      // CORS & frontend URL — update after frontend domain is generated
      CORS_ORIGINS: preserve(),
      FRONTEND_URL: preserve(),
      WS_URL: preserve(),

      // WebRTC — STUN only initially; TURN deferred to Phase 12C
      WEBRTC_STUN_URLS: "stun:stun.l.google.com:19302",
      WEBRTC_TURN_URL: "",
      WEBRTC_TURN_USERNAME: "",
      WEBRTC_TURN_CREDENTIAL: "",
    },
  });

  // ── Frontend — React / Vite static build ───────────────────────────
  const frontend = service("proctorai-frontend", {
    // rootDirectory is set via Railway dashboard → Service Settings → Source
    build: "npm ci && npm run build",
    start: "npx serve -s dist",
    replicas: 1,
    env: {
      // Set REAL backend domain after backend is deployed.
      // These are baked into the Vite bundle at BUILD time.
      VITE_API_BASE_URL: preserve(),
      VITE_WS_BASE_URL: preserve(),
    },
  });

  // ── Canvas organisation ────────────────────────────────────────────
  const backendGroup = group("Backend", [db, backend]);

  return project("proctorai", {
    resources: [backendGroup, frontend],
  });
});
