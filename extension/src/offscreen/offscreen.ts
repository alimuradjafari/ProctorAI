/**
 * Offscreen document for camera acquisition and face detection.
 *
 * Architecture:
 *   Service Worker  --(START_CAMERA_MONITORING)-->  Offscreen
 *   Offscreen       --(FACE_MONITORING_EVENT)---->  Service Worker
 *   Offscreen       --(CAMERA_STATUS_UPDATE)------>  Service Worker
 *   Offscreen       --(CHECK_MONITORING_SESSION_STATUS)-->  Service Worker
 *
 * This document:
 * 1. Opens the webcam via getUserMedia (video only, no microphone)
 * 2. Initialises MediaPipe FaceDetector (bundled WASM + model)
 * 3. Runs inference at ~2 FPS
 * 4. Feeds face-count into FacePresenceDetector (temporal persistence)
 * 5. Sends confirmed anomaly events to the service worker
 * 6. Periodically asks the service worker to verify session is still LIVE
 */

import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision'
import { FacePresenceDetector } from '../camera/FacePresenceDetector'
import type { FaceDetectorEvent } from '../camera/FacePresenceDetector'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Target inference rate: ~2 FPS → 500 ms between samples. */
const SAMPLE_INTERVAL_MS = 500

/** How often to ask the service worker to verify the session is still LIVE. */
const SESSION_CHECK_INTERVAL_MS = 15_000

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let videoElement: HTMLVideoElement | null = null
let mediaStream: MediaStream | null = null
let faceDetector: FaceDetector | null = null
let presenceDetector: FacePresenceDetector | null = null
let inferenceTimer: ReturnType<typeof setInterval> | null = null
let sessionCheckTimer: ReturnType<typeof setInterval> | null = null
let inferenceRunning = false
let running = false
let starting = false  // Guard against concurrent start attempts

// ---------------------------------------------------------------------------
// Camera lifecycle
// ---------------------------------------------------------------------------

async function startCamera(): Promise<void> {
  // Idempotency: reject if already running or start-in-progress
  if (running || starting) return
  starting = true

  sendStatus('starting')

  try {
    // 1. Open camera — video only, NO microphone
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    })

    videoElement = document.getElementById('camera') as HTMLVideoElement
    videoElement.srcObject = mediaStream

    // Wait for video to actually have a frame ready
    await videoElement.play()
    await waitForVideoReady(videoElement)

    // Listen for track ended (e.g., webcam unplugged)
    for (const track of mediaStream.getTracks()) {
      track.addEventListener('ended', () => {
        console.warn('[ProctorAI Offscreen] Camera track ended unexpectedly')
        stopCamera()
        sendStatus('error')
      })
    }

    // 2. Initialise MediaPipe FaceDetector (WASM + model loading)
    await initDetector()

    // 3. Construct FacePresenceDetector AFTER both camera and detector are ready.
    //    This ensures the 3-second grace period starts from the moment inference
    //    can actually begin, not from camera/model initialization time.
    presenceDetector = new FacePresenceDetector()

    // 4. Start inference loop
    startInferenceLoop()

    // 5. Start session health check
    startSessionCheckLoop()

    running = true
    starting = false
    sendStatus('active')
    console.log('[ProctorAI Offscreen] Camera monitoring active')
  } catch (err) {
    console.error('[ProctorAI Offscreen] Camera start failed:', err)

    // Clean up any partially-opened resources
    cleanupPartialResources()

    running = false
    starting = false
    sendStatus(err instanceof DOMException && err.name === 'NotAllowedError'
      ? 'denied'
      : 'error')
  }
}

/**
 * Wait until the video element has a usable frame with valid dimensions.
 */
async function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) return

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Video readiness timeout'))
    }, 10_000)

    video.addEventListener('loadeddata', () => {
      clearTimeout(timeout)
      resolve()
    }, { once: true })

    video.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('Video element error'))
    }, { once: true })
  })
}

function stopCamera(): void {
  // Safe to call multiple times — early return if not running
  if (!running && !starting) return
  running = false
  starting = false

  // Stop inference timer first to prevent further inference calls
  if (inferenceTimer !== null) {
    clearInterval(inferenceTimer)
    inferenceTimer = null
  }

  // Stop session check
  if (sessionCheckTimer !== null) {
    clearInterval(sessionCheckTimer)
    sessionCheckTimer = null
  }

  // Flag prevents inference from emitting during teardown
  inferenceRunning = true

  // Dispose MediaPipe detector
  if (faceDetector) {
    try { faceDetector.close() } catch { /* ignore */ }
    faceDetector = null
  }

  // Reset temporal detector
  if (presenceDetector) {
    presenceDetector.reset()
    presenceDetector = null
  }

  // Stop all media tracks
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop()
    }
    mediaStream = null
  }

  if (videoElement) {
    videoElement.srcObject = null
    videoElement = null
  }

  inferenceRunning = false

  try { sendStatus('inactive') } catch { /* messaging may fail during teardown */ }
  console.log('[ProctorAI Offscreen] Camera monitoring stopped')
}

/**
 * Clean up partially-opened resources when startCamera fails.
 */
function cleanupPartialResources(): void {
  if (faceDetector) {
    try { faceDetector.close() } catch { /* ignore */ }
    faceDetector = null
  }

  presenceDetector = null

  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop()
    }
    mediaStream = null
  }

  if (videoElement) {
    videoElement.srcObject = null
    videoElement = null
  }

  inferenceRunning = false
}

// ---------------------------------------------------------------------------
// MediaPipe FaceDetector initialisation
// ---------------------------------------------------------------------------

async function initDetector(): Promise<void> {
  // WASM files are at the extension root (copied from node_modules at build time)
  const wasmPath = chrome.runtime.getURL('wasm/')
  const vision = await FilesetResolver.forVisionTasks(wasmPath)

  // Model is bundled locally in models/ (copied from public/ at build time)
  const modelPath = chrome.runtime.getURL('models/blaze_face_short_range.tflite')

  faceDetector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelPath,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.5,
  })

  console.log('[ProctorAI Offscreen] MediaPipe FaceDetector ready')
}

// ---------------------------------------------------------------------------
// Inference loop (~2 FPS)
// ---------------------------------------------------------------------------

function startInferenceLoop(): void {
  inferenceTimer = setInterval(() => {
    // Overlap protection: skip if previous inference still in progress
    if (inferenceRunning) return
    inferenceRunning = true

    try {
      runInference()
    } catch (err) {
      // Detector errors are logged but NEVER interpreted as face_count=0
      console.debug('[ProctorAI Offscreen] Inference error:', err)
    } finally {
      inferenceRunning = false
    }
  }, SAMPLE_INTERVAL_MS)
}

function runInference(): void {
  if (!videoElement || !faceDetector || !presenceDetector) return

  // Video readiness guard: must have metadata + valid dimensions
  if (videoElement.readyState < 2) return
  if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) return

  // Monotonically increasing timestamp for MediaPipe VIDEO mode
  const timestamp = performance.now()
  const result = faceDetector.detectForVideo(videoElement, timestamp)
  const faceCount = result.detections?.length ?? 0

  const event = presenceDetector.processFrame(faceCount, Date.now())
  if (event) {
    sendEventToServiceWorker(event)
  }
}

// ---------------------------------------------------------------------------
// Session health check (every 15 seconds)
// ---------------------------------------------------------------------------

function startSessionCheckLoop(): void {
  sessionCheckTimer = setInterval(() => {
    chrome.runtime.sendMessage({
      target: 'service-worker',
      type: 'CHECK_MONITORING_SESSION_STATUS',
    }).catch(() => { /* service worker may have suspended */ })
  }, SESSION_CHECK_INTERVAL_MS)
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

function sendEventToServiceWorker(event: FaceDetectorEvent): void {
  chrome.runtime.sendMessage({
    target: 'service-worker',
    type: 'FACE_MONITORING_EVENT',
    event,
  }).catch(() => { /* service worker may have suspended */ })
}

function sendStatus(status: string): void {
  chrome.runtime.sendMessage({
    target: 'service-worker',
    type: 'CAMERA_STATUS_UPDATE',
    status,
  }).catch(() => { /* service worker may have suspended */ })
}

// ---------------------------------------------------------------------------
// Message listener — commands from service worker / popup
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return false

  switch (message.type) {
    case 'START_CAMERA_MONITORING':
      // Idempotent: only start if not already running or starting
      if (!running && !starting) {
        void startCamera()
      }
      sendResponse({ ok: true })
      break

    case 'STOP_CAMERA_MONITORING':
      stopCamera()
      sendResponse({ ok: true })
      break

    case 'GET_CAMERA_STATUS':
      sendResponse({
        running,
        starting,
        status: running ? 'active' : starting ? 'starting' : 'inactive',
      })
      break

    case 'SESSION_STATUS_RESULT':
      // Service worker replied with session status
      if (message.status !== 'live') {
        console.log(`[ProctorAI Offscreen] Session no longer LIVE (${message.status}) — stopping camera`)
        stopCamera()
      }
      break
  }

  return true
})

// ---------------------------------------------------------------------------
// Cleanup on page unload
// ---------------------------------------------------------------------------

window.addEventListener('beforeunload', () => {
  stopCamera()
})
