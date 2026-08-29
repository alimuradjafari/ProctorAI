// ProctorAI Background Service Worker
// Handles browser monitoring: tab-switch and window-state detection.
//
// Monitoring runs here (not in popup) because the popup is ephemeral.
// Armed whenever a valid participant session exists in chrome.storage.local.

import { apiService } from '../services/api'
import type { ParticipantSession, EventSubmissionRequest, EventType } from '../types'

const STORAGE_KEY = 'proctorai_session'

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
 *
 * Used for detecting transitions between:
 * normal, minimized, maximized, fullscreen
 */
const windowStateTracker = new Map<number, ChromeWindowState>()

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
 * Silently ignored failures (session missing, backend unavailable, not LIVE).
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

/**
 * Snapshot the currently active tab when monitoring starts.
 *
 * This prevents us from blindly ignoring the first real tab switch after
 * a Manifest V3 service worker restart.
 */
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

/**
 * Detect active-tab changes.
 *
 * We do not read or transmit:
 * - URL
 * - page title
 * - hostname
 * - browsing history
 */
function onTabActivated(activeInfo: chrome.tabs.TabActiveInfo): void {
  // Avoid duplicate for the same tab activation
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

/**
 * Snapshot current state for all browser windows.
 *
 * This establishes the baseline so we only detect genuine transitions.
 * Does NOT emit events for the initial snapshot.
 */
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

/**
 * Determine the event to emit for a window state transition.
 *
 * Transition rules (Phase 5.1):
 *
 * A) fullscreen -> non-fullscreen:
 *    Emit ONLY fullscreen_exit (no other event).
 *
 * B) non-minimized -> minimized:
 *    Emit window_minimized.
 *
 * C) non-maximized/non-fullscreen -> maximized:
 *    Emit window_maximized.
 *
 * D) maximized -> normal OR minimized -> normal/maximized:
 *    Emit window_restored.
 *    BUT NOT on fullscreen -> X (already covered by A).
 *
 * Returns null if no event should be emitted.
 */
function resolveTransitionEvent(
  previousState: ChromeWindowState,
  currentState: ChromeWindowState
): EventType | null {
  // No transition
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

  // Rule C: window maximized
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

/**
 * Map event type to client_event_id prefix.
 */
function eventIdPrefix(eventType: EventType): string {
  const prefixes: Record<string, string> = {
    fullscreen_exit: 'fullscreen-exit',
    window_minimized: 'window-minimized',
    window_maximized: 'window-maximized',
    window_restored: 'window-restored',
  }
  return prefixes[eventType] || eventType
}

/**
 * Detect window state transitions and emit appropriate events.
 */
function onWindowBoundsChanged(win: chrome.windows.Window): void {
  if (win.id === undefined || !win.state) {
    return
  }

  const windowId = win.id
  const currentState = win.state as ChromeWindowState
  const previousState = windowStateTracker.get(windowId)

  // Update tracked state immediately to prevent duplicate emissions
  // from rapid onBoundsChanged callbacks for the same final state.
  windowStateTracker.set(windowId, currentState)

  // No baseline yet — first observation, don't emit
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

/**
 * Remove state for closed windows.
 */
function onWindowRemoved(windowId: number): void {
  windowStateTracker.delete(windowId)
}

// ---------------------------------------------------------------------------
// Monitoring lifecycle
// ---------------------------------------------------------------------------

/**
 * Attach monitoring listeners.
 * Safe to call multiple times — listeners are only attached once.
 */
function attachListeners(): void {
  if (listenersAttached) {
    return
  }

  chrome.tabs.onActivated.addListener(onTabActivated)
  chrome.windows.onBoundsChanged.addListener(onWindowBoundsChanged)
  chrome.windows.onRemoved.addListener(onWindowRemoved)

  // Initialize detector baselines
  void initActiveTab()
  void initWindowStates()

  listenersAttached = true

  console.log('[ProctorAI] Monitoring listeners attached')
}

/**
 * Detach monitoring listeners.
 * Called when participant session is removed from storage.
 */
function detachListeners(): void {
  if (!listenersAttached) {
    return
  }

  chrome.tabs.onActivated.removeListener(onTabActivated)
  chrome.windows.onBoundsChanged.removeListener(onWindowBoundsChanged)
  chrome.windows.onRemoved.removeListener(onWindowRemoved)

  // Reset detector state
  lastActiveTabId = null
  windowStateTracker.clear()

  listenersAttached = false

  console.log('[ProctorAI] Monitoring listeners detached')
}

// ---------------------------------------------------------------------------
// Storage change listener
// Arm/disarm monitoring based on participant session presence
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return
  }

  const sessionChange = changes[STORAGE_KEY]

  if (!sessionChange) {
    return
  }

  const newValue =
    sessionChange.newValue as ParticipantSession | undefined

  if (newValue?.participant_access_token) {
    attachListeners()
  } else {
    detachListeners()
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
 * If a participant session already exists, re-arm monitoring.
 */
void getStoredSession().then((session) => {
  if (session) {
    attachListeners()
  }
})

// ---------------------------------------------------------------------------
// Messages from popup
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    if (message.type === 'GET_STATUS') {
      sendResponse({
        status: listenersAttached ? 'monitoring' : 'idle',
      })
    }

    return true
  }
)
