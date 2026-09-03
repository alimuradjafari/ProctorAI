// ProctorAI Background Service Worker
// Handles browser monitoring: tab-switch, window-state, and camera face detection.
//
// Monitoring runs here (not in popup) because the popup is ephemeral.
// Armed whenever a valid participant session exists in chrome.storage.local.
// Camera processing runs in a separate MV3 offscreen document.

import { apiService } from '../services/api'
import type { ParticipantSession, EventSubmissionRequest, EventType } from '../types'

const STORAGE_KEY = 'proctorai_session'
const CAMERA_ENABLED_KEY = 'camera_monitoring_enabled'

// ---------------------------------------------------------------------------
// Chrome window state type
// ---------------------------------------------------------------------------

type ChromeWindowState = 'normal' | 'minimized' | 'maximized' | 'fullscreen'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Previous active tab ID — used to avoid duplicate events for the same activation. */
let lastActiveTabId: number | null = null

/** Whether monitoring listeners have been attached. */
let listenersAttached = false

/**
 * Window state tracker.
 * Key: windowId, Value: the previous Chrome window state.
 */
const windowStateTracker = new Map<number, ChromeWindowState>()

/** Guard to prevent concurrent offscreen document creation. */
let offscreenCreationPromise: Promise<void> | null = null

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

async function getStoredSession(): Promise<ParticipantSession | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    const stored = result[STORAGE_KEY] as ParticipantSession | undefined

    if (stored?.participant_access_token) {
      return stored
    }
  } catch {
    // Storage unavailable
  }

  return null
}

// ---------------------------------------------------------------------------
// Event submission wrapper
// ---------------------------------------------------------------------------

/**
 * Submit a monitoring event using the stored participant token.
 * Silently ignores failures (session missing, backend unavailable, not LIVE).
 * Does not retry.
 */
async function submitEvent(event: EventSubmissionRequest): Promise<void> {
  const session = await getStoredSession()

  if (!session) {
    console.debug('[ProctorAI] No active session — event skipped')
    return
  }

  try {
    await apiService.sendMonitoringEvent(
      session.participant_access_token,
      event
    )

    console.debug(
      `[ProctorAI] Event sent: ${event.event_type} (${event.client_event_id})`
    )
  } catch (err) {
    // Log but don't crash or retry
    console.debug(
      `[ProctorAI] Event submission failed: ${
        err instanceof Error ? err.message : 'unknown'
      }`
    )
  }
}

// ---------------------------------------------------------------------------
// Tab switch detection
// ---------------------------------------------------------------------------

async function initActiveTab(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })

    const activeTab = tabs[0]

    if (activeTab?.id !== undefined) {
      lastActiveTabId = activeTab.id
    }
  } catch {
    // Keep null if Chrome tab state cannot be resolved
  }
}

function onTabActivated(activeInfo: chrome.tabs.TabActiveInfo): void {
  if (activeInfo.tabId === lastActiveTabId) {
    return
  }

  lastActiveTabId = activeInfo.tabId

  const event: EventSubmissionRequest = {
    event_type: 'tab_switch',
    client_event_id: `tab-switch-${crypto.randomUUID()}`,
    client_occurred_at: new Date().toISOString(),
    metadata: {
      source: 'chrome_tabs',
    },
  }

  void submitEvent(event)
}

// ---------------------------------------------------------------------------
// Window state detection — Phase 5 + 5.1
// ---------------------------------------------------------------------------

async function initWindowStates(): Promise<void> {
  try {
    const windows = await chrome.windows.getAll()

    for (const win of windows) {
      if (win.id !== undefined && win.state) {
        windowStateTracker.set(win.id, win.state as ChromeWindowState)
      }
    }
  } catch {
    // Chrome windows API may not be available in some contexts
  }
}

function resolveTransitionEvent(
  previousState: ChromeWindowState,
  currentState: ChromeWindowState
): EventType | null {
  if (previousState === currentState) {
    return null
  }

  // Rule A: fullscreen exit
  if (previousState === 'fullscreen' && currentState !== 'fullscreen') {
    return 'fullscreen_exit'
  }

  // Rule B: window minimized
  if (currentState === 'minimized' && previousState !== 'minimized') {
    return 'window_minimized'
  }

  // Rule C: window maximized (not from minimized, not from fullscreen)
  if (
    currentState === 'maximized' &&
    previousState !== 'maximized' &&
    previousState !== 'fullscreen' &&
    previousState !== 'minimized'
  ) {
    return 'window_maximized'
  }

  // Rule D: window restored
  // D1: maximized -> normal
  if (previousState === 'maximized' && currentState === 'normal') {
    return 'window_restored'
  }
  // D2: minimized -> normal or maximized
  if (
    previousState === 'minimized' &&
    (currentState === 'normal' || currentState === 'maximized')
  ) {
    return 'window_restored'
  }

  // All other transitions — no event
  return null
}

function eventIdPrefix(eventType: EventType): string {
  const prefixes: Record<string, string> = {
    fullscreen_exit: 'fullscreen-exit',
    window_minimized: 'window-minimized',
    window_maximized: 'window-maximized',
    window_restored: 'window-restored',
  }
  return prefixes[eventType] || eventType
}

function onWindowBoundsChanged(win: chrome.windows.Window): void {
  if (win.id === undefined || !win.state) {
    return
  }

  const windowId = win.id
  const currentState = win.state as ChromeWindowState
  const previousState = windowStateTracker.get(windowId)

  windowStateTracker.set(windowId, currentState)

  if (previousState === undefined) {
    return
  }

  const eventType = resolveTransitionEvent(previousState, currentState)

  if (eventType) {
    const event: EventSubmissionRequest = {
      event_type: eventType,
      client_event_id: `${eventIdPrefix(eventType)}-${crypto.randomUUID()}`,
      client_occurred_at: new Date().toISOString(),
      metadata: {
        source: 'chrome_window',
        from_state: previousState,
        to_state: currentState,
      },
    }

    void submitEvent(event)
  }
}

function onWindowRemoved(windowId: number): void {
  windowStateTracker.delete(windowId)
}

// ---------------------------------------------------------------------------
// Offscreen document lifecycle (Phase 6 — Camera)
// ---------------------------------------------------------------------------

/**
 * Ensure the offscreen document exists, creating it if needed.
 * Uses a module-level Promise guard to prevent concurrent creation.
 */
async function ensureOffscreenDocument(): Promise<void> {
  // Serialize concurrent callers
  if (offscreenCreationPromise) {
    await offscreenCreationPromise
    return
  }

  offscreenCreationPromise = ensureOffscreenDocumentInner()
  try {
    await offscreenCreationPromise
  } finally {
    offscreenCreationPromise = null
  }
}

async function ensureOffscreenDocumentInner(): Promise<void> {
  try {
    // Check if offscreen already exists via getContexts (Chrome 116+)
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    })

    if (contexts.length > 0) {
      return // Already running
    }
  } catch {
    // getContexts may not be available — proceed to create
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA' as chrome.offscreen.Reason],
    justification: 'Local webcam face-presence monitoring during an active proctored session.',
  })

  console.log('[ProctorAI] Offscreen document created')
}

/**
 * Close the offscreen document if it exists.
 */
async function closeOffscreenDocument(): Promise<void> {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    })

    if (contexts.length > 0) {
      await chrome.offscreen.closeDocument()
      console.log('[ProctorAI] Offscreen document closed')
    }
  } catch {
    // Already closed or not available
  }
}

/**
 * Start camera monitoring by ensuring the offscreen document exists
 * and sending it a START command.
 */
async function startCameraMonitoring(): Promise<void> {
  await ensureOffscreenDocument()

  // Small delay to let the offscreen document initialize
  await new Promise(resolve => setTimeout(resolve, 500))

  chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'START_CAMERA_MONITORING',
  }).catch(() => {
    // Offscreen may not be ready yet
  })

  // Persist camera monitoring state for SW restart recovery
  await chrome.storage.local.set({ [CAMERA_ENABLED_KEY]: true })
}

/**
 * Stop camera monitoring — tells offscreen to stop and close.
 */
async function stopCameraMonitoring(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'STOP_CAMERA_MONITORING',
    })
  } catch {
    // Offscreen may already be gone
  }

  await closeOffscreenDocument()
  await chrome.storage.local.set({ [CAMERA_ENABLED_KEY]: false })
}

/**
 * Check if the participant session is still LIVE.
 * Called when the offscreen document asks for a status check.
 */
async function checkSessionStatus(): Promise<void> {
  const session = await getStoredSession()

  if (!session) {
    // Session gone — stop camera
    await stopCameraMonitoring()
    return
  }

  try {
    const me = await apiService.getParticipantMe(session.participant_access_token)

    // Relay status back to offscreen
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'SESSION_STATUS_RESULT',
      status: me.session_status,
    }).catch(() => { /* offscreen may have closed */ })

    // If session ended/cancelled, stop camera
    if (me.session_status === 'ended' || me.session_status === 'cancelled') {
      await stopCameraMonitoring()
    }
  } catch {
    // Backend unreachable — don't destroy camera session
    // Will retry on next interval
    console.debug('[ProctorAI] Session status check failed — will retry')
  }
}

// ---------------------------------------------------------------------------
// Camera permission page coordination
// ---------------------------------------------------------------------------

/**
 * Open the camera-permission page in a new tab.
 * Requires a stored participant session with LIVE status.
 */
async function openCameraPermissionPage(): Promise<{ success: boolean; error?: string }> {
  const session = await getStoredSession()

  if (!session) {
    return { success: false, error: 'No active session' }
  }

  try {
    const me = await apiService.getParticipantMe(session.participant_access_token)

    if (me.session_status !== 'live') {
      return { success: false, error: `Session is ${me.session_status}, not live` }
    }
  } catch {
    return { success: false, error: 'Unable to verify session status' }
  }

  // chrome.tabs.create does NOT require the "tabs" permission
  // (tabs permission only grants access to tab URLs/titles)
  const permissionUrl = chrome.runtime.getURL('camera-permission.html')
  await chrome.tabs.create({ url: permissionUrl })

  console.log('[ProctorAI] Camera permission page opened')
  return { success: true }
}

/**
 * Called when the camera-permission page reports success.
 * Re-validates session is LIVE, then starts the existing offscreen camera path.
 */
async function handleCameraPermissionGranted(): Promise<void> {
  const session = await getStoredSession()

  if (!session) {
    console.warn('[ProctorAI] CAMERA_PERMISSION_GRANTED but no stored session')
    return
  }

  try {
    const me = await apiService.getParticipantMe(session.participant_access_token)

    if (me.session_status !== 'live') {
      console.log(`[ProctorAI] Session is ${me.session_status} — not starting camera after permission`)
      await chrome.storage.local.set({ camera_status: 'inactive' })
      return
    }
  } catch {
    console.warn('[ProctorAI] Cannot verify session after camera permission — not starting camera')
    await chrome.storage.local.set({ camera_status: 'error' })
    return
  }

  // Session is LIVE and permission was granted — start offscreen monitoring
  console.log('[ProctorAI] Camera permission granted — starting offscreen monitoring')
  await startCameraMonitoring()
}

/**
 * Called when the camera-permission page reports failure.
 * Ensures camera_monitoring_enabled stays false and updates status.
 */
async function handleCameraPermissionFailed(reason: string): Promise<void> {
  console.log(`[ProctorAI] Camera permission failed: ${reason}`)

  const status = reason === 'denied' ? 'denied' : 'error'
  await chrome.storage.local.set({ camera_status: status })
  await chrome.storage.local.set({ [CAMERA_ENABLED_KEY]: false })
}

// ---------------------------------------------------------------------------
// Monitoring lifecycle
// ---------------------------------------------------------------------------

function attachListeners(): void {
  if (listenersAttached) {
    return
  }

  chrome.tabs.onActivated.addListener(onTabActivated)
  chrome.windows.onBoundsChanged.addListener(onWindowBoundsChanged)
  chrome.windows.onRemoved.addListener(onWindowRemoved)

  void initActiveTab()
  void initWindowStates()

  listenersAttached = true

  console.log('[ProctorAI] Monitoring listeners attached')
}

function detachListeners(): void {
  if (!listenersAttached) {
    return
  }

  chrome.tabs.onActivated.removeListener(onTabActivated)
  chrome.windows.onBoundsChanged.removeListener(onWindowBoundsChanged)
  chrome.windows.onRemoved.removeListener(onWindowRemoved)

  lastActiveTabId = null
  windowStateTracker.clear()

  listenersAttached = false

  console.log('[ProctorAI] Monitoring listeners detached')
}

// ---------------------------------------------------------------------------
// Storage change listener
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return
  }

  const sessionChange = changes[STORAGE_KEY]

  if (sessionChange) {
    const newValue = sessionChange.newValue as ParticipantSession | undefined

    if (newValue?.participant_access_token) {
      attachListeners()
    } else {
      detachListeners()
      // Session removed — also stop camera
      void stopCameraMonitoring()
    }
  }
})

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('ProctorAI extension installed')
  } else if (details.reason === 'update') {
    console.log('ProctorAI extension updated')
  }
})

/**
 * Manifest V3 service workers may restart.
 * Re-arm browser monitoring if participant session exists.
 *
 * Camera recovery requires:
 * 1. Stored participant session/token exists
 * 2. camera_monitoring_enabled flag is true
 * 3. Backend confirms session_status === 'live' via /me endpoint
 *
 * If backend is unreachable or session is not LIVE, do NOT reopen camera.
 */
void (async () => {
  const session = await getStoredSession()
  if (session) {
    attachListeners()

    // Check if camera monitoring was previously enabled
    const result = await chrome.storage.local.get(CAMERA_ENABLED_KEY)
    if (result[CAMERA_ENABLED_KEY]) {
      // Verify session is still LIVE before recovering camera
      try {
        const me = await apiService.getParticipantMe(session.participant_access_token)

        if (me.session_status === 'live') {
          console.log('[ProctorAI] Recovering camera monitoring after SW restart')
          void startCameraMonitoring()
        } else {
          console.log(`[ProctorAI] Session is ${me.session_status} — not recovering camera`)
          await chrome.storage.local.set({ [CAMERA_ENABLED_KEY]: false })
        }
      } catch {
        // Backend unreachable — do NOT blindly reopen camera
        console.log('[ProctorAI] Backend unreachable during SW restart — deferring camera recovery')
      }
    }
  }
})()

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

/** Camera-generated event types accepted from the offscreen document. */
const CAMERA_EVENT_WHITELIST = new Set([
  'no_face',
  'multiple_faces',
  'phone_detected',
  'suspicious_object',
])

chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    // ---- Popup messages ----
    if (message.type === 'GET_STATUS') {
      sendResponse({
        status: listenersAttached ? 'monitoring' : 'idle',
      })
    }

    else if (message.type === 'REQUEST_CAMERA_PERMISSION') {
      // Popup asks to open the camera-permission page
      void openCameraPermissionPage().then((result) => sendResponse(result))
      return true // async sendResponse
    }

    else if (message.type === 'CAMERA_PERMISSION_GRANTED') {
      // Permission page reports success
      void handleCameraPermissionGranted()
      sendResponse({ ok: true })
    }

    else if (message.type === 'CAMERA_PERMISSION_FAILED') {
      // Permission page reports failure
      void handleCameraPermissionFailed(message.reason || 'error')
      sendResponse({ ok: true })
    }

    else if (message.type === 'START_CAMERA') {
      void startCameraMonitoring()
      sendResponse({ ok: true })
    }

    else if (message.type === 'STOP_CAMERA') {
      void stopCameraMonitoring()
      sendResponse({ ok: true })
    }

    // ---- Offscreen document messages ----
    else if (message.target === 'service-worker') {
      if (
        message.type === 'FACE_MONITORING_EVENT' ||
        message.type === 'OBJECT_MONITORING_EVENT'
      ) {
        // Strict whitelist: only these four camera-generated event types are accepted.
        // Do NOT accept severity, monitoring_session_id, instructor_id, etc.
        const event = message.event
        if (
          event &&
          typeof event.event_type === 'string' &&
          CAMERA_EVENT_WHITELIST.has(event.event_type)
        ) {
          void submitEvent({
            event_type: event.event_type,
            confidence: event.confidence,
            client_event_id: event.client_event_id,
            client_occurred_at: event.client_occurred_at,
            metadata: event.metadata,
          })
        }
      }

      else if (message.type === 'CAMERA_STATUS_UPDATE') {
        // Store camera status so popup can read it
        void chrome.storage.local.set({ camera_status: message.status })

        // Clear enabled flag on failure or inactive states
        if (
          message.status === 'denied' ||
          message.status === 'error' ||
          message.status === 'inactive'
        ) {
          void chrome.storage.local.set({ [CAMERA_ENABLED_KEY]: false })
        }
      }

      else if (message.type === 'CHECK_MONITORING_SESSION_STATUS') {
        void checkSessionStatus()
      }
    }

    return true
  }
)
