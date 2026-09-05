/**
 * Extension URL configuration — single source of truth for backend endpoints.
 *
 * Values come from Vite environment variables (VITE_*).
 * In development: set via .env.development (committed).
 * In production:   set via .env.production (gitignored, NOT committed).
 *
 * VITE_API_BASE_URL and VITE_WS_BASE_URL must NOT include a trailing slash.
 * The API base URL does NOT include the /api prefix — the ApiService appends it.
 */

const rawApiBase = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(
  /\/$/,
  ''
)
const rawWsBase = (import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:8000').replace(
  /\/$/,
  ''
)

/** Full API base URL including the /api prefix (e.g. http://localhost:8000/api). */
export const API_BASE_URL = `${rawApiBase}/api`

/** WebSocket base URL (e.g. ws://localhost:8000). */
export const WS_BASE_URL = rawWsBase

/**
 * Production backend host — used by the Vite build to inject into manifest
 * host_permissions. Empty in development; set in production .env.
 */
export const PROD_API_HOST: string = import.meta.env.VITE_PROD_API_HOST || ''
