// ProctorAI Background Service Worker
// Handles browser monitoring: tab-switch, window-state, and camera face detection.
//
// Monitoring runs here (not in popup) because the popup is ephemeral.
// Armed whenever a valid participant session exists in chrome.storage.local.
// Camera processing runs in a separate MV3 offscreen document.

import { apiService } from '../services/api'
import type { ParticipantSession, EventSubmissionRequest, EventType } from '../types'
import {
  ExamWindowFocusDetector,
  FOCUS_LOSS_CONFIRM_MS,
  type FocusDestination,
} from '../browser/ExamWindowFocusDetector'

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
// Screen review state (Phase 10.1)
// ---------------------------------------------------------------------------

/** Active screen review request ID (null when no review is active). */
let activeScreenReviewId: string | null = null

/** Suppress exam_window_focus_lost events during the Chrome screen picker. */
let suppressFocusEvents = false

/** Safety timeout for focus suppression (auto-clear after 60s). */
let suppressFocusTimeout: ReturnType<typeof setTimeout> | null = null

/** Participant WebSocket for screen review signaling. */
let participantScreenReviewWs: WebSocket | null = null

/** Whether the participant screen review WS is connecting. */
let screenReviewWsConnecting = false

const WS_BASE_URL = 'ws://localhost:8000'

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

  // Phase 9.2 — the exam window closed while monitoring was active.
  // Focus loss immediately around the closure may already have been
  // reported through the natural onFocusChanged path; from here on focus
  // events stay inert (no exam window to compare against).
  if (windowId === examWindowId) {
    examWindowId = null
    monitoredTabId = null
    focusDetector = null
    cancelFocusConfirmCheck()
  }
}

// ---------------------------------------------------------------------------
// Exam window focus monitoring — Phase 9.2
// ---------------------------------------------------------------------------

/**
 * Phase 9.2 debug switch. Logs window IDs and resolved destinations only —
 * never tokens, URLs, tab titles, or external application information.
 */
const DEBUG_WINDOW_FOCUS = false

/** The monitored exam tab (followed across window moves via tabs.onAttached). */
let monitoredTabId: number | null = null

/** The Chrome window containing the monitored exam tab. */
let examWindowId: number | null = null

/** Pure focus-loss detector instance (null while monitoring is disarmed). */
let focusDetector: ExamWindowFocusDetector | null = null

/**
 * Pending confirmation-check timer. Sustained focus loss produces no further
 * Chrome focus events, so temporal confirmation needs synthetic samples.
 */
let focusConfirmTimer: ReturnType<typeof setTimeout> | null = null

/** Guards attach/detach races during async focus initialization. */
let focusInitGeneration = 0

/**
 * Bind the authoritative exam tab/window and (re)start the focus detector.
 *
 * The exam window is determined HERE in the service worker from the tab the
 * participant armed monitoring from — never from content scripts, the popup,
 * or client payloads.
 *
 * If the exam window does not currently hold focus, the detector starts in
 * its 'fired' state: the pre-existing focus-loss episode is never reported,
 * and detection re-arms only after the exam window regains focus.
 */
async function initFocusMonitoring(): Promise<void> {
  const generation = ++focusInitGeneration
  const now = Date.now()

  let tabId: number | null = null
  let windowId: number | null = null

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    if (tab?.id !== undefined && tab.windowId !== undefined) {
      tabId = tab.id
      windowId = tab.windowId
    }
  } catch {
    // Tabs API unavailable — leave unbound; focus events stay inert
  }

  let examFocused = false
  if (windowId !== null) {
    try {
      const lastFocused = await chrome.windows.getLastFocused()
      if (lastFocused.focused && lastFocused.id === windowId) {
        examFocused = true
      }
    } catch {
      // Windows API unavailable — assume not focused (conservative)
    }
  }

  // Attach/detach may have raced the async queries above
  if (generation !== focusInitGeneration || !listenersAttached) {
    return
  }

  monitoredTabId = tabId
  examWindowId = windowId
  focusDetector = new ExamWindowFocusDetector(now, examFocused)

  if (DEBUG_WINDOW_FOCUS) {
    console.debug(
      `[ProctorAI Focus] bound examWindow=${windowId} tab=${tabId} focused=${examFocused}`
    )
  }
}

/** Map the currently focused Chrome window onto a focus destination. */
function resolveFocusDestination(win: chrome.windows.Window): FocusDestination {
  if (!win.focused) {
    // No Chrome window currently has focus (another browser, another
    // application, OS UI, desktop, or the task switcher).
    return 'outside_chrome'
  }
  if (examWindowId !== null && win.id === examWindowId) {
    return 'exam_window'
  }
  return 'other_chrome_window'
}

/** Feed a focus sample to the detector and submit any confirmed event. */
function handleFocusSample(destination: FocusDestination): void {
  if (!listenersAttached || focusDetector === null || suppressFocusEvents) {
    return
  }

  const events = focusDetector.processSample({ destination }, Date.now())

  for (const event of events) {
    if (DEBUG_WINDOW_FOCUS) {
      console.debug(
        `[ProctorAI Focus] exam_window_focus_lost ` +
        `destination=${event.metadata.focus_destination} ` +
        `persistence_ms=${event.metadata.persistence_ms}`
      )
    }
    void submitEvent(event)
  }

  // Keep the temporal-confirmation timer chain running while a candidate
  // is pending; stop it once the detector has settled.
  if (focusDetector.isConfirming()) {
    scheduleFocusConfirmCheck()
  } else {
    cancelFocusConfirmCheck()
  }
}

/**
 * Query the current focus and feed it to the detector as a synthetic sample.
 * Called by the confirmation timer — sustained focus loss produces no
 * further Chrome events, so confirmation needs samples over time.
 */
async function feedCurrentFocus(): Promise<void> {
  if (!listenersAttached || focusDetector === null) {
    return
  }

  try {
    const win = await chrome.windows.getLastFocused()
    handleFocusSample(resolveFocusDestination(win))
  } catch {
    // Windows API unavailable — skip this synthetic sample
  }
}

/** Schedule a one-shot confirmation check (one pending timer at a time). */
function scheduleFocusConfirmCheck(): void {
  if (focusConfirmTimer !== null) {
    return
  }
  focusConfirmTimer = setTimeout(() => {
    focusConfirmTimer = null
    void feedCurrentFocus()
  }, FOCUS_LOSS_CONFIRM_MS)
}

/** Cancel any pending confirmation check (focus returned / state settled). */
function cancelFocusConfirmCheck(): void {
  if (focusConfirmTimer !== null) {
    clearTimeout(focusConfirmTimer)
    focusConfirmTimer = null
  }
}

/**
 * chrome.windows.onFocusChanged handler — the ONLY focus signal source.
 *
 * Registered once at module scope (below) so it survives MV3 service-worker
 * restarts — Chrome only persists top-level synchronous registrations. The
 * handler does nothing unless participant monitoring is armed.
 */
function onWindowFocusChanged(windowId: number): void {
  if (!listenersAttached || focusDetector === null || suppressFocusEvents) {
    return
  }

  let destination: FocusDestination
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // No Chrome window has focus — another browser, another application,
    // OS UI, or the task switcher. We do NOT identify which.
    destination = 'outside_chrome'
  } else if (examWindowId !== null && windowId === examWindowId) {
    destination = 'exam_window'
  } else {
    destination = 'other_chrome_window'
  }

  if (DEBUG_WINDOW_FOCUS) {
    console.debug(
      `[ProctorAI Focus] examWindow=${examWindowId} focusedWindow=${windowId} ` +
      `destination=${destination}`
    )
  }

  handleFocusSample(destination)
}

// Registered exactly once per service-worker lifecycle — never re-added from
// attachListeners(), so focus changes can also wake the worker.
chrome.windows.onFocusChanged.addListener(onWindowFocusChanged)

/**
 * The monitored exam tab moved to a different Chrome window (dragged out).
 * Follow it by rebinding the exam window — the move itself is NOT a
 * focus-loss event; only an actual loss of focus is.
 */
function onTabAttached(
  tabId: number,
  attachInfo: chrome.tabs.TabAttachInfo
): void {
  if (tabId !== monitoredTabId) {
    return
  }

  examWindowId = attachInfo.newWindowId

  if (DEBUG_WINDOW_FOCUS) {
    console.debug(`[ProctorAI Focus] exam tab moved — examWindow=${examWindowId}`)
  }
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
    reasons: [
      'USER_MEDIA' as chrome.offscreen.Reason,
      'DISPLAY_MEDIA' as chrome.offscreen.Reason,
      'WEB_RTC' as chrome.offscreen.Reason,
    ],
    justification: 'Local webcam face-presence monitoring and optional live screen review during proctored sessions.',
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
// Browser geometry monitoring commands — Phase 9.1
// ---------------------------------------------------------------------------

/**
 * Send a START/STOP command to content-script geometry monitors.
 *
 * - START goes only to the currently active tab of every window (one
 *   detector per window — avoids duplicate events from multiple tabs
 *   sharing one window).
 * - STOP is broadcast to all tabs so every running detector stops.
 *
 * Tabs without a content-script receiver (chrome:// pages, Web Store, etc.)
 * simply reject the send — that is expected and ignored.
 */
async function sendGeometryCommand(
  type: 'START_BROWSER_GEOMETRY_MONITORING' | 'STOP_BROWSER_GEOMETRY_MONITORING',
  allTabs: boolean
): Promise<void> {
  try {
    const query: chrome.tabs.QueryInfo = allTabs ? {} : { active: true }
    const tabs = await chrome.tabs.query(query)

    for (const tab of tabs) {
      if (tab.id !== undefined) {
        chrome.tabs.sendMessage(tab.id, { type }).catch(() => {
          // No receiver in this tab — fine
        })
      }
    }
  } catch {
    // tabs API unavailable — geometry monitoring is not armed this round;
    // content scripts re-ask via GEOMETRY_MONITORING_QUERY_STATE on page load
  }
}

// ---------------------------------------------------------------------------
// Screen review (Phase 10.1) — Participant signaling WebSocket
// ---------------------------------------------------------------------------

/**
 * Connect to the backend participant screen review WebSocket.
 * Authenticates with the stored participant JWT.
 * Routes incoming signaling messages to the content script or offscreen.
 */
async function connectParticipantScreenReviewWs(): Promise<void> {
  if (participantScreenReviewWs || screenReviewWsConnecting) {
    return
  }

  const session = await getStoredSession()
  if (!session) return

  screenReviewWsConnecting = true

  try {
    const ws = new WebSocket(`${WS_BASE_URL}/ws/participant-screen-review`)
    participantScreenReviewWs = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'authenticate',
        access_token: session.participant_access_token,
      }))
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string)
        handleScreenReviewWsMessage(data)
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = () => {
      participantScreenReviewWs = null
      screenReviewWsConnecting = false

      // Reconnect if monitoring is still active
      if (listenersAttached) {
        setTimeout(() => {
          void connectParticipantScreenReviewWs()
        }, 3000)
      }
    }

    ws.onerror = () => {
      // onclose will fire after onerror
    }
  } catch {
    screenReviewWsConnecting = false
  }
}

/**
 * Handle a message from the participant screen review WebSocket.
 * Routes messages to the content script overlay or offscreen document.
 */
function handleScreenReviewWsMessage(data: Record<string, unknown>): void {
  const type = data.type as string

  if (type === 'authenticated') {
    console.log('[ProctorAI] Screen review WS authenticated')
    return
  }

  if (type === 'screen_review_request') {
    // Instructor requested screen review — show consent to student
    activeScreenReviewId = data.screen_review_id as string
    routeToActiveTab({
      type: 'SHOW_SCREEN_REVIEW_CONSENT',
      screen_review_id: activeScreenReviewId,
    })
    return
  }

  if (type === 'screen_review_answer') {
    // Instructor sent SDP answer — relay to offscreen
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'SCREEN_REVIEW_ANSWER',
      sdp: data.sdp,
      screen_review_id: data.screen_review_id,
    }).catch(() => {})
    return
  }

  if (type === 'screen_review_ice_candidate') {
    // ICE candidate from instructor — relay to offscreen
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'SCREEN_REVIEW_ICE_CANDIDATE',
      candidate: data.candidate,
      sdpMid: data.sdpMid,
      sdpMLineIndex: data.sdpMLineIndex,
      screen_review_id: data.screen_review_id,
    }).catch(() => {})
    return
  }

  if (type === 'screen_review_stopped') {
    // Remote stop from instructor
    cleanupScreenReview()
    return
  }
}

/** Check whether a URL scheme allows content-script injection. */
function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return false
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')
}

/**
 * Send a screen-review UI message to the monitored exam tab.
 *
 * Validates that the target tab has an injectable URL (http/https).
 * If the monitored tab is a restricted page (chrome://, edge://, etc.),
 * searches for an injectable tab in the exam window as fallback.
 * Pings first to verify the content script is loaded; if absent,
 * programmatically injects it and retries once.
 */
function routeToActiveTab(message: Record<string, unknown>): void {
  if (monitoredTabId === null) {
    console.warn(
      '[ProctorAI] Cannot route screen review message: monitored exam tab is not available',
      message.type
    )
    return
  }

  // Step 1: Get tab details and validate URL
  chrome.tabs.get(monitoredTabId)
    .then(async (tab) => {
      console.log('[ProctorAI] Screen review target tab:', {
        id: monitoredTabId,
        url: tab.url,
        status: tab.status,
      })

      let targetTabId = monitoredTabId as number

      // Step 2: If monitored tab is not injectable, search exam window
      if (!isInjectableUrl(tab.url)) {
        console.warn(
          '[ProctorAI] Monitored tab is not injectable:',
          tab.url,
          '— searching for injectable tab in exam window'
        )

        const fallbackId = await findInjectableTabInExamWindow()
        if (fallbackId === null) {
          console.error(
            '[ProctorAI] No injectable tab found in exam window.',
            'Student must navigate to an http(s) page before screen review can work.'
          )
          return
        }

        targetTabId = fallbackId
        console.log('[ProctorAI] Using fallback injectable tab:', targetTabId)
      }

      // Step 3: Ping to check if content script is loaded
      try {
        const response = await chrome.tabs.sendMessage(
          targetTabId,
          { type: 'PING_SCREEN_REVIEW_OVERLAY' }
        )

        if (response?.ok) {
          // Content script present — send actual message
          await chrome.tabs.sendMessage(targetTabId, message)
          console.log(
            '[ProctorAI] Screen review message routed to tab:',
            message.type,
            targetTabId
          )
          return
        }

        // Unexpected response — try injecting
        console.warn(
          '[ProctorAI] Overlay ping unexpected response, injecting into tab',
          targetTabId
        )
      } catch (pingErr) {
        // Ping failed — content script not loaded. Inject programmatically.
        console.warn(
          '[ProctorAI] Overlay not loaded in tab, injecting programmatically:',
          targetTabId, pingErr
        )
      }

      // Step 4: Inject and send
      await injectAndSend(targetTabId, message)
      console.log(
        '[ProctorAI] Screen review message routed to tab:',
        message.type,
        targetTabId
      )
    })
    .catch((err) => {
      console.error(
        '[ProctorAI] Failed to route screen review message:',
        message.type,
        monitoredTabId,
        err
      )
    })
}

/**
 * Search for an injectable tab (http/https) in the exam window.
 * Returns the tab ID or null if none found.
 */
async function findInjectableTabInExamWindow(): Promise<number | null> {
  try {
    const queryOpts: chrome.tabs.QueryInfo = {}
    if (examWindowId !== null) {
      queryOpts.windowId = examWindowId
    }
    const tabs = await chrome.tabs.query(queryOpts)
    for (const tab of tabs) {
      if (tab.id !== undefined && isInjectableUrl(tab.url)) {
        return tab.id
      }
    }
  } catch {
    // Tabs query failed
  }
  return null
}

/**
 * Programmatically inject the screen-review overlay content script
 * into a tab and then send a message to it.
 */
async function injectAndSend(
  tabId: number,
  message: Record<string, unknown>
): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['screen-review-overlay.js'],
  })
  console.log('[ProctorAI] Injected screen-review-overlay.js into tab', tabId)
  // Brief delay for listener registration after injection
  await new Promise((resolve) => setTimeout(resolve, 100))
  await chrome.tabs.sendMessage(tabId, message)
}

/**
 * Initiate Chrome desktop capture after student consents.
 * Suppresses focus monitoring during the picker to avoid false violations.
 */
function startDesktopCapture(reviewId: string): void {
  // Suppress focus events during the Chrome picker
  suppressFocusEvents = true

  // Safety timeout: auto-clear suppression after 60s
  if (suppressFocusTimeout) clearTimeout(suppressFocusTimeout)

  suppressFocusTimeout = setTimeout(() => {
    suppressFocusEvents = false
    suppressFocusTimeout = null
  }, 60_000)

  try {
    chrome.desktopCapture.chooseDesktopMedia(
      ['screen'],
      (streamId) => {
        clearFocusSuppression()

        if (!streamId) {
          // Student cancelled the picker
          sendScreenReviewDeclined(reviewId)
          return
        }

        // Send the short-lived stream ID immediately to the offscreen document
        chrome.runtime
          .sendMessage({
            target: 'offscreen',
            type: 'START_SCREEN_SHARE',
            streamId,
            screen_review_id: reviewId,
            iceServers: [], // Local dev; Phase 12 can add STUN/TURN
          })
          .catch((err) => {
            console.error(
              '[ProctorAI] Failed to start screen share:',
              err
            )
            cleanupScreenReview()
          })

        // Show student that live screen review is active
        routeToActiveTab({
          type: 'SHOW_SCREEN_REVIEW_ACTIVE',
          screen_review_id: reviewId,
        })
      }
    )
  } catch (err) {
    console.error(
      '[ProctorAI] Failed to open desktop capture picker:',
      err
    )
    clearFocusSuppression()
    sendScreenReviewDeclined(reviewId)
  }
}

function clearFocusSuppression(): void {
  suppressFocusEvents = false
  if (suppressFocusTimeout) {
    clearTimeout(suppressFocusTimeout)
    suppressFocusTimeout = null
  }
}

function sendScreenReviewDeclined(reviewId: string): void {
  if (participantScreenReviewWs && participantScreenReviewWs.readyState === WebSocket.OPEN) {
    participantScreenReviewWs.send(JSON.stringify({
      type: 'screen_review_declined',
      screen_review_id: reviewId,
    }))
  }
  cleanupScreenReview()
}

/**
 * Clean up screen review state. Idempotent.
 */
function cleanupScreenReview(): void {
  activeScreenReviewId = null
  clearFocusSuppression()

  // Stop offscreen screen share
  chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'STOP_SCREEN_SHARE',
  }).catch(() => {})

  // Hide overlay
  routeToActiveTab({ type: 'HIDE_SCREEN_REVIEW_OVERLAY' })
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
  chrome.tabs.onAttached.addListener(onTabAttached)

  void initActiveTab()
  void initWindowStates()

  // Phase 9.2 — bind the exam tab/window and restart the focus detector.
  // The onFocusChanged listener itself stays registered at module scope.
  void initFocusMonitoring()

  // Phase 9.1 — arm browser geometry (side-panel) monitoring in the
  // active tab of every window. Backend remains authoritative for LIVE.
  void sendGeometryCommand('START_BROWSER_GEOMETRY_MONITORING', false)

  // Phase 10.1 — connect participant screen review WebSocket
  void connectParticipantScreenReviewWs()

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
  chrome.tabs.onAttached.removeListener(onTabAttached)

  lastActiveTabId = null
  windowStateTracker.clear()

  // Phase 9.2 — drop the exam-window binding and stop the focus detector.
  // The module-scope onFocusChanged listener stays registered but inert.
  // Repeated STOP is safe: the early return plus idempotent clears make
  // this a no-op when monitoring is already detached.
  focusInitGeneration++ // invalidate any in-flight init
  monitoredTabId = null
  examWindowId = null
  focusDetector = null
  cancelFocusConfirmCheck()

  // Phase 9.1 — stop every running geometry detector (end/cancel/logout)
  void sendGeometryCommand('STOP_BROWSER_GEOMETRY_MONITORING', true)

  // Phase 10.1 — disconnect screen review WS and clean up
  if (participantScreenReviewWs) {
    participantScreenReviewWs.close()
    participantScreenReviewWs = null
  }
  screenReviewWsConnecting = false
  cleanupScreenReview()

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

    // Phase 10.1 — reconnect screen review WS
    void connectParticipantScreenReviewWs()
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
  'looking_away',
  'camera_obscured',
])

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
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

    // ---- Offscreen document + content script messages ----
    else if (message.target === 'service-worker') {
      if (
        message.type === 'FACE_MONITORING_EVENT' ||
        message.type === 'OBJECT_MONITORING_EVENT' ||
        message.type === 'LANDMARK_MONITORING_EVENT' ||
        message.type === 'INTEGRITY_MONITORING_EVENT'
      ) {
        // Strict whitelist: only these camera-generated event types are accepted.
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

      else if (message.type === 'GEOMETRY_MONITORING_QUERY_STATE') {
        // Content script (page load) asks whether browser monitoring is
        // armed. Synchronous response so the tab can arm itself after
        // navigation without missing detection.
        sendResponse({ active: listenersAttached })
      }

      else if (message.type === 'BROWSER_GEOMETRY_MONITORING_EVENT') {
        // Phase 9.1 — browser side-panel event from a content script.
        //
        // STRICT VALIDATION (tab security):
        //   1. sender.tab must exist (real content-script sender)
        //   2. browser monitoring must be armed (participant session exists)
        //   3. event_type must be exactly 'browser_side_panel'
        //
        // Trusted IDs (participant/session/instructor), severity, and risk
        // data are NEVER read from the message — the server owns all of
        // those. The backend still rejects submissions for non-LIVE sessions.
        const event = message.event
        if (
          sender.tab &&
          sender.tab.id !== undefined &&
          listenersAttached &&
          event &&
          typeof event === 'object' &&
          typeof event.event_type === 'string' &&
          event.event_type === 'browser_side_panel' &&
          typeof event.client_event_id === 'string' &&
          event.client_event_id.length > 0
        ) {
          void submitEvent({
            event_type: 'browser_side_panel',
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

      // --- Screen review messages (Phase 10.1) ---

      else if (message.type === 'SCREEN_REVIEW_CONSENT') {
        // Content script overlay reports student consent
        const reviewId = message.screen_review_id as string
        const accepted = message.accepted as boolean

        if (!reviewId || reviewId !== activeScreenReviewId) {
          sendResponse({ ok: false })
          return true
        }

        if (accepted) {
          // Student accepted — start desktop capture
          startDesktopCapture(reviewId)
        } else {
          // Student declined
          sendScreenReviewDeclined(reviewId)
        }

        sendResponse({ ok: true })
      }

      else if (message.type === 'SCREEN_REVIEW_STOP_FROM_STUDENT') {
        // Student clicked "Stop" in the active indicator
        const reviewId = message.screen_review_id as string
        if (reviewId === activeScreenReviewId) {
          // Send stopped message to backend
          if (participantScreenReviewWs && participantScreenReviewWs.readyState === WebSocket.OPEN) {
            participantScreenReviewWs.send(JSON.stringify({
              type: 'screen_review_stopped',
              screen_review_id: reviewId,
            }))
          }
          cleanupScreenReview()
        }
        sendResponse({ ok: true })
      }

      else if (message.type === 'SCREEN_REVIEW_OFFER') {
        // Offscreen generated SDP offer — relay to backend
        const reviewId = message.screen_review_id as string
        const sdp = message.sdp as string

        if (reviewId && sdp && participantScreenReviewWs &&
            participantScreenReviewWs.readyState === WebSocket.OPEN) {
          participantScreenReviewWs.send(JSON.stringify({
            type: 'screen_review_offer',
            screen_review_id: reviewId,
            sdp,
          }))
        }
        sendResponse({ ok: true })
      }

      else if (message.type === 'SCREEN_REVIEW_ICE_CANDIDATE') {
        // Offscreen generated ICE candidate — relay to backend
        const reviewId = message.screen_review_id as string
        const candidate = message.candidate as string

        if (reviewId && candidate && participantScreenReviewWs &&
            participantScreenReviewWs.readyState === WebSocket.OPEN) {
          participantScreenReviewWs.send(JSON.stringify({
            type: 'screen_review_ice_candidate',
            screen_review_id: reviewId,
            candidate,
            sdpMid: message.sdpMid ?? null,
            sdpMLineIndex: message.sdpMLineIndex ?? null,
          }))
        }
        sendResponse({ ok: true })
      }

      else if (message.type === 'SCREEN_REVIEW_STOPPED') {
        // Offscreen screen share ended (track ended by user or error)
        const reviewId = message.screen_review_id as string
        if (reviewId === activeScreenReviewId) {
          if (participantScreenReviewWs && participantScreenReviewWs.readyState === WebSocket.OPEN) {
            participantScreenReviewWs.send(JSON.stringify({
              type: 'screen_review_stopped',
              screen_review_id: reviewId,
            }))
          }
          cleanupScreenReview()
        }
        sendResponse({ ok: true })
      }
    }

    return true
  }
)
