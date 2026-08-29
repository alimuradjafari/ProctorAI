// ProctorAI Background Service Worker
// Handles browser monitoring: tab-switch and fullscreen-exit detection.
//
// Monitoring runs here (not in popup) because the popup is ephemeral.
// Armed whenever a valid participant session exists in chrome.storage.local.

import { apiService } from '../services/api'
import type { ParticipantSession, EventSubmissionRequest } from '../types'

const STORAGE_KEY = 'proctorai_session'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Previous active tab ID — used to avoid duplicate events for the same activation. */
let lastActiveTabId: number | null = null

/** Whether monitoring listeners have been attached. */
let listenersAttached = false

/**
 * Window fullscreen state tracker.
 * Key: windowId, Value: whether the window was last known to be fullscreen.
 */
const windowFullscreenState = new Map<number, boolean>()

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
// Fullscreen exit detection
// ---------------------------------------------------------------------------

/**
 * Snapshot current fullscreen state for all browser windows.
 *
 * This ensures we only detect a genuine:
 * fullscreen -> non-fullscreen
 *
 * and do not treat a normal browser startup as a fullscreen exit.
 */
async function initWindowStates(): Promise<void> {
  try {
    const windows = await chrome.windows.getAll()

    for (const win of windows) {
      if (win.id !== undefined) {
        windowFullscreenState.set(
          win.id,
          win.state === 'fullscreen'
        )
      }
    }
  } catch {
    // Chrome windows API may not be available in some contexts
  }
}

/**
 * Detect window state transitions.
 */
function onWindowBoundsChanged(win: chrome.windows.Window): void {
  if (win.id === undefined) {
    return
  }

  const windowId = win.id

  const wasFullscreen =
    windowFullscreenState.get(windowId) ?? false

  const isFullscreen = win.state === 'fullscreen'

  // Update tracked state
  windowFullscreenState.set(windowId, isFullscreen)

  // Emit only for a genuine fullscreen -> non-fullscreen transition
  if (wasFullscreen && !isFullscreen) {
    const event: EventSubmissionRequest = {
      event_type: 'fullscreen_exit',
      client_event_id: `fullscreen-exit-${crypto.randomUUID()}`,
      client_occurred_at: new Date().toISOString(),
      metadata: {
        source: 'chrome_window',
      },
    }

    void submitEvent(event)
  }
}

/**
 * Remove state for closed windows.
 */
function onWindowRemoved(windowId: number): void {
  windowFullscreenState.delete(windowId)
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
  windowFullscreenState.clear()

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