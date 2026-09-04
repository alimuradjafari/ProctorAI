// ProctorAI Content Script — Browser Geometry Monitor (Phase 9.1)
//
// PRIVACY: samples ONLY browser-window geometry numbers
// (window.outerWidth, window.innerWidth, window.visualViewport.width,
// window.devicePixelRatio). It NEVER inspects page content, text, form
// fields, exam questions, clipboard, browser history, or screenshots.
//
// Dormant by default. Sampling starts only when the service worker sends
// START_BROWSER_GEOMETRY_MONITORING (armed participant session). On page
// load the script asks the service worker whether monitoring is armed so
// that navigation within the exam tab does not silently disable detection.
//
// Only the VISIBLE tab of each window samples geometry — this avoids
// duplicate events from multiple tabs sharing one window.

import { BrowserSidePanelDetector, type GeometrySample } from '../browser/BrowserSidePanelDetector'

/** Set to true only while tuning thresholds; false for release. */
const DEBUG_BROWSER_GEOMETRY = false

/** Periodic geometry sampling interval (ms). */
const GEOMETRY_SAMPLE_INTERVAL_MS = 250

/** Whether the service worker has armed this tab. */
let armed = false

/** Active side-panel detector — non-null only while sampling. */
let detector: BrowserSidePanelDetector | null = null

/** Periodic sampling timer handle. */
let sampleTimer: ReturnType<typeof setInterval> | null = null

// ---------------------------------------------------------------------------
// Geometry sampling
// ---------------------------------------------------------------------------

function captureSample(): GeometrySample {
  return {
    outerWidth: window.outerWidth,
    innerWidth: window.innerWidth,
    visualViewportWidth: window.visualViewport?.width,
    devicePixelRatio: window.devicePixelRatio,
  }
}

function sampleNow(): void {
  if (!detector) {
    return
  }

  const sample = captureSample()
  const events = detector.processSample(sample, Date.now())

  if (DEBUG_BROWSER_GEOMETRY) {
    console.debug(
      '[ProctorAI Geometry]',
      `outer=${sample.outerWidth}`,
      `inner=${sample.innerWidth}`,
      `events=${events.length}`,
    )
  }

  for (const event of events) {
    // Confirmed browser_side_panel event — forward to the service worker,
    // which validates it and submits it through the authenticated pipeline.
    chrome.runtime
      .sendMessage({
        target: 'service-worker',
        type: 'BROWSER_GEOMETRY_MONITORING_EVENT',
        event,
      })
      .catch(() => {
        // Service worker unavailable — event is dropped (idempotency key
        // would have prevented duplicates anyway)
      })
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function startSampling(): void {
  if (!armed || sampleTimer !== null) {
    return
  }

  // Fresh detector: a fresh baseline + startup grace every time sampling
  // (re)starts — geometry may have changed while this tab was hidden.
  detector = new BrowserSidePanelDetector(Date.now())
  sampleNow()
  sampleTimer = setInterval(sampleNow, GEOMETRY_SAMPLE_INTERVAL_MS)
}

function stopSampling(): void {
  if (sampleTimer !== null) {
    clearInterval(sampleTimer)
    sampleTimer = null
  }
  detector = null
}

function arm(): void {
  armed = true
  // Only the visible tab of a window samples geometry.
  if (document.visibilityState === 'visible') {
    startSampling()
  }
}

function disarm(): void {
  armed = false
  stopSampling()
}

// ---------------------------------------------------------------------------
// Message + visibility handling
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'START_BROWSER_GEOMETRY_MONITORING') {
    arm()
  } else if (message?.type === 'STOP_BROWSER_GEOMETRY_MONITORING') {
    disarm()
  }
  // All other message types are ignored — this listener stays passive.
})

document.addEventListener('visibilitychange', () => {
  if (!armed) {
    return
  }
  if (document.visibilityState === 'visible') {
    startSampling() // fresh baseline — geometry may have changed while hidden
  } else {
    stopSampling()
  }
})

// Resize events give the detector immediate feedback while the window is
// being dragged (the periodic sample covers the steady state).
window.addEventListener('resize', () => {
  sampleNow()
})

// ---------------------------------------------------------------------------
// Startup — ask the service worker whether monitoring is armed
// (content scripts do not survive page loads, so every navigation re-asks)
// ---------------------------------------------------------------------------

void (async () => {
  try {
    const response = await chrome.runtime.sendMessage({
      target: 'service-worker',
      type: 'GEOMETRY_MONITORING_QUERY_STATE',
    })
    if (response?.active) {
      arm()
    }
  } catch {
    // Service worker unavailable — stay dormant
  }
})()
