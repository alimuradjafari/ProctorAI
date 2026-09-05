/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend HTTP base URL (no trailing slash). Example: http://localhost:8000 */
  readonly VITE_API_BASE_URL: string
  /** Backend WebSocket base URL (no trailing slash). Example: ws://localhost:8000 */
  readonly VITE_WS_BASE_URL: string
  /**
   * Production backend host (used by the Vite build to inject into
   * manifest host_permissions). Empty in development.
   * Example: https://api.proctorai.example.com
   */
  readonly VITE_PROD_API_HOST: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
