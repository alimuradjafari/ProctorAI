/**
 * Offscreen document for camera acquisition, face detection, and object detection.
 *
 * Architecture:
 *   Service Worker  --(START_CAMERA_MONITORING)-->  Offscreen
 *   Offscreen       --(FACE_MONITORING_EVENT)---->  Service Worker
 *   Offscreen       --(OBJECT_MONITORING_EVENT)--->  Service Worker
 *   Offscreen       --(CAMERA_STATUS_UPDATE)------>  Service Worker
 *   Offscreen       --(CHECK_MONITORING_SESSION_STATUS)-->  Service Worker
 *
 * This document:
 * 1. Opens the webcam via getUserMedia (video only, no microphone)
 * 2. Initialises MediaPipe FaceDetector (bundled WASM + model)
 * 3. Initialises MediaPipe ObjectDetector (bundled WASM + model)
 * 4. Runs face inference at ~4 FPS and object inference at ~5 FPS
 * 5. Feeds results into FacePresenceDetector and ObjectPresenceDetector
 * 6. Sends confirmed anomaly events to the service worker
 * 7. Periodically asks the service worker to verify session is still LIVE
 */

import {
  FilesetResolver,
  FaceDetector,
  ObjectDetector,
  FaceLandmarker,
} from '@mediapipe/tasks-vision'

import { FacePresenceDetector } from '../camera/FacePresenceDetector'
import type { FaceDetectorEvent } from '../camera/FacePresenceDetector'

import { ObjectPresenceDetector } from '../camera/ObjectPresenceDetector'
import type {
  ObjectDetectorEvent,
  ObjectSampleInput,
} from '../camera/ObjectPresenceDetector'

import { HeadOrientationDetector } from '../camera/HeadOrientationDetector'
import type { HeadSampleInput } from '../camera/HeadOrientationDetector'

import {
  FrameIntegrityDetector,
  classifyFrame,
} from '../camera/FrameIntegrityDetector'
import type { FrameStatsInput } from '../camera/FrameIntegrityDetector'

// ---------------------------------------------------------------------------
// MediaPipe types
// ---------------------------------------------------------------------------

/**
 * Resolved WASM fileset returned by FilesetResolver.forVisionTasks().
 *
 * Let TypeScript derive this from the installed MediaPipe package instead
 * of incorrectly typing the result as FilesetResolver itself.
 */
type VisionFileset = Awaited<
  ReturnType<typeof FilesetResolver.forVisionTasks>
>

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Target face inference rate: ~4 FPS → 250 ms between samples. */
const SAMPLE_INTERVAL_MS = 250

/** Target object inference rate: ~5 FPS → 200 ms between samples. */
const OBJECT_SAMPLE_INTERVAL_MS = 200

/** Target face-landmarker inference rate: ~3 FPS → 333 ms between samples. */
const LANDMARK_SAMPLE_INTERVAL_MS = 333

/** Target frame-integrity analysis rate: ~2 FPS → 500 ms between samples. */
const FRAME_INTEGRITY_INTERVAL_MS = 500

/** Downsampled canvas width for frame-integrity analysis. */
const INTEGRITY_WIDTH = 32

/** Downsampled canvas height for frame-integrity analysis. */
const INTEGRITY_HEIGHT = 24

// ---- Head orientation thresholds ----

/**
 * Normalized yaw threshold for looking left/right.
 * yawNorm = (noseX - eyeCenterX) / interEyeDistance
 * Values above this indicate head turned noticeably.
 */
const YAW_THRESHOLD = 0.35

// ---- MediaPipe face landmark indices ----

/** Nose tip — primary reference for head orientation. */
const LM_NOSE_TIP = 1
/** Left eye outer corner (right side of screen in mirrored view). */
const LM_LEFT_EYE_OUTER = 33
/** Right eye outer corner. */
const LM_RIGHT_EYE_OUTER = 263

/** How often to ask the service worker to verify the session is still LIVE. */
const SESSION_CHECK_INTERVAL_MS = 15_000

/**
 * Temporary development logging.
 * Set to false before final commit.
 */
const DEBUG_DETECTION = false

/** COCO label for cell phone — maps to phone_detected event. */
const PHONE_LABEL = 'cell phone'

/**
 * Prohibited object labels — map to suspicious_object event.
 * Add more labels here in future phases.
 */
const PROHIBITED_OBJECT_LABELS = new Set([
  'book',
])

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let videoElement: HTMLVideoElement | null = null
let mediaStream: MediaStream | null = null

let faceDetector: FaceDetector | null = null
let objectDetector: ObjectDetector | null = null
let faceLandmarker: FaceLandmarker | null = null

let presenceDetector: FacePresenceDetector | null = null
let objectPresenceDetector: ObjectPresenceDetector | null = null
let headOrientationDetector: HeadOrientationDetector | null = null
let frameIntegrityDetector: FrameIntegrityDetector | null = null

let inferenceTimer: ReturnType<typeof setInterval> | null = null
let objectInferenceTimer: ReturnType<typeof setInterval> | null = null
let landmarkInferenceTimer: ReturnType<typeof setInterval> | null = null
let frameIntegrityTimer: ReturnType<typeof setInterval> | null = null
let sessionCheckTimer: ReturnType<typeof setInterval> | null = null

let inferenceRunning = false
let objectInferenceRunning = false
let landmarkInferenceRunning = false
let frameIntegrityRunning = false

/** Offscreen canvas for frame-integrity downsampling. */
let integrityCanvas: OffscreenCanvas | null = null
let integrityCtx: OffscreenCanvasRenderingContext2D | null = null

let running = false
let starting = false

// ---------------------------------------------------------------------------
// Camera lifecycle
// ---------------------------------------------------------------------------

async function startCamera(): Promise<void> {
  // Idempotency: reject if already running or start-in-progress
  if (running || starting) {
    return
  }

  starting = true

  sendStatus('starting')

  try {
    // -----------------------------------------------------------------------
    // 1. Open camera — video only, NO microphone
    // -----------------------------------------------------------------------

    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: {
          ideal: 640,
        },
        height: {
          ideal: 480,
        },
        facingMode: 'user',
      },
      audio: false,
    })

    videoElement = document.getElementById(
      'camera'
    ) as HTMLVideoElement

    if (!videoElement) {
      throw new Error(
        'Camera video element was not found'
      )
    }

    videoElement.srcObject = mediaStream

    // Wait for video to actually have a frame ready
    await videoElement.play()
    await waitForVideoReady(videoElement)

    // Listen for track ended (for example webcam unplugged)
    for (const track of mediaStream.getTracks()) {
      track.addEventListener('ended', () => {
        console.warn(
          '[ProctorAI Offscreen] Camera track ended unexpectedly'
        )

        stopCamera()
        sendStatus('error')
      })
    }

    // -----------------------------------------------------------------------
    // 2. Initialise MediaPipe FaceDetector
    // -----------------------------------------------------------------------

    const vision = await initFaceDetector()

    // -----------------------------------------------------------------------
    // 3. Initialise MediaPipe ObjectDetector
    // -----------------------------------------------------------------------

    await initObjectDetector(vision)

    // -----------------------------------------------------------------------
    // 4. Initialise MediaPipe FaceLandmarker
    // -----------------------------------------------------------------------

    await initFaceLandmarker(vision)

    // -----------------------------------------------------------------------
    // 5. Initialise frame-integrity analyzer
    // -----------------------------------------------------------------------

    initFrameIntegrity()

    // -----------------------------------------------------------------------
    // 6. Construct temporal detectors AFTER all detectors are ready
    // -----------------------------------------------------------------------
    //
    // This ensures the startup grace period begins only when inference
    // can actually start, not while the camera/model is loading.

    const now = Date.now()

    presenceDetector =
      new FacePresenceDetector(now)

    objectPresenceDetector =
      new ObjectPresenceDetector(now)

    headOrientationDetector =
      new HeadOrientationDetector(now)

    frameIntegrityDetector =
      new FrameIntegrityDetector(now)

    // -----------------------------------------------------------------------
    // 7. Start face inference loop (~4 FPS)
    // -----------------------------------------------------------------------

    startInferenceLoop()

    // -----------------------------------------------------------------------
    // 8. Start object inference loop (~5 FPS)
    // -----------------------------------------------------------------------

    startObjectInferenceLoop()

    // -----------------------------------------------------------------------
    // 9. Start landmark inference loop (~3 FPS)
    // -----------------------------------------------------------------------

    startLandmarkInferenceLoop()

    // -----------------------------------------------------------------------
    // 10. Start frame-integrity loop (~2 FPS)
    // -----------------------------------------------------------------------

    startFrameIntegrityLoop()

    // -----------------------------------------------------------------------
    // 11. Start session health check
    // -----------------------------------------------------------------------

    startSessionCheckLoop()

    running = true
    starting = false

    sendStatus('active')

    console.log(
      '[ProctorAI Offscreen] Camera monitoring active'
    )
  } catch (err) {
    console.error(
      '[ProctorAI Offscreen] Camera start failed:',
      err
    )

    // Clean up any partially-opened resources
    cleanupPartialResources()

    running = false
    starting = false

    sendStatus(
      err instanceof DOMException &&
        err.name === 'NotAllowedError'
        ? 'denied'
        : 'error'
    )
  }
}

/**
 * Wait until the video element has a usable frame with valid dimensions.
 */
async function waitForVideoReady(
  video: HTMLVideoElement
): Promise<void> {
  if (
    video.readyState >= 2 &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  ) {
    return
  }

  return new Promise<void>(
    (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            'Video readiness timeout'
          )
        )
      }, 10_000)

      const handleLoadedData = () => {
        if (
          video.videoWidth > 0 &&
          video.videoHeight > 0
        ) {
          clearTimeout(timeout)
          resolve()
        } else {
          clearTimeout(timeout)
          reject(
            new Error(
              'Video loaded without valid dimensions'
            )
          )
        }
      }

      video.addEventListener(
        'loadeddata',
        handleLoadedData,
        {
          once: true,
        }
      )

      video.addEventListener(
        'error',
        () => {
          clearTimeout(timeout)

          reject(
            new Error(
              'Video element error'
            )
          )
        },
        {
          once: true,
        }
      )
    }
  )
}

function stopCamera(): void {
  // Safe to call multiple times
  if (!running && !starting) {
    return
  }

  running = false
  starting = false

  // -------------------------------------------------------------------------
  // Stop face inference timer
  // -------------------------------------------------------------------------

  if (inferenceTimer !== null) {
    clearInterval(inferenceTimer)
    inferenceTimer = null
  }

  // -------------------------------------------------------------------------
  // Stop object inference timer
  // -------------------------------------------------------------------------

  if (objectInferenceTimer !== null) {
    clearInterval(objectInferenceTimer)
    objectInferenceTimer = null
  }

  // -------------------------------------------------------------------------
  // Stop landmark inference timer
  // -------------------------------------------------------------------------

  if (landmarkInferenceTimer !== null) {
    clearInterval(landmarkInferenceTimer)
    landmarkInferenceTimer = null
  }

  // -------------------------------------------------------------------------
  // Stop frame-integrity timer
  // -------------------------------------------------------------------------

  if (frameIntegrityTimer !== null) {
    clearInterval(frameIntegrityTimer)
    frameIntegrityTimer = null
  }

  // -------------------------------------------------------------------------
  // Stop session check
  // -------------------------------------------------------------------------

  if (sessionCheckTimer !== null) {
    clearInterval(sessionCheckTimer)
    sessionCheckTimer = null
  }

  // Prevent inference from emitting during teardown
  inferenceRunning = true
  objectInferenceRunning = true
  landmarkInferenceRunning = true
  frameIntegrityRunning = true

  // -------------------------------------------------------------------------
  // Dispose MediaPipe FaceDetector
  // -------------------------------------------------------------------------

  if (faceDetector) {
    try {
      faceDetector.close()
    } catch {
      // Ignore teardown errors
    }

    faceDetector = null
  }

  // -------------------------------------------------------------------------
  // Dispose MediaPipe ObjectDetector
  // -------------------------------------------------------------------------

  if (objectDetector) {
    try {
      objectDetector.close()
    } catch {
      // Ignore teardown errors
    }

    objectDetector = null
  }

  // -------------------------------------------------------------------------
  // Dispose MediaPipe FaceLandmarker
  // -------------------------------------------------------------------------

  if (faceLandmarker) {
    try {
      faceLandmarker.close()
    } catch {
      // Ignore teardown errors
    }

    faceLandmarker = null
  }

  // -------------------------------------------------------------------------
  // Reset temporal detectors
  // -------------------------------------------------------------------------

  if (presenceDetector) {
    presenceDetector.reset()
    presenceDetector = null
  }

  if (objectPresenceDetector) {
    objectPresenceDetector.reset()
    objectPresenceDetector = null
  }

  if (headOrientationDetector) {
    headOrientationDetector.reset(Date.now())
    headOrientationDetector = null
  }

  if (frameIntegrityDetector) {
    frameIntegrityDetector.reset(Date.now())
    frameIntegrityDetector = null
  }

  // -------------------------------------------------------------------------
  // Stop media tracks
  // -------------------------------------------------------------------------

  if (mediaStream) {
    for (
      const track of
      mediaStream.getTracks()
    ) {
      track.stop()
    }

    mediaStream = null
  }

  if (videoElement) {
    videoElement.srcObject = null
    videoElement = null
  }

  inferenceRunning = false
  objectInferenceRunning = false
  landmarkInferenceRunning = false
  frameIntegrityRunning = false

  try {
    sendStatus('inactive')
  } catch {
    // Messaging may fail during teardown
  }

  console.log(
    '[ProctorAI Offscreen] Camera monitoring stopped'
  )
}

/**
 * Clean up partially-opened resources when startCamera fails.
 */
function cleanupPartialResources(): void {
  // -------------------------------------------------------------------------
  // Stop any timers that may have started
  // -------------------------------------------------------------------------

  if (inferenceTimer !== null) {
    clearInterval(inferenceTimer)
    inferenceTimer = null
  }

  if (objectInferenceTimer !== null) {
    clearInterval(objectInferenceTimer)
    objectInferenceTimer = null
  }

  if (landmarkInferenceTimer !== null) {
    clearInterval(landmarkInferenceTimer)
    landmarkInferenceTimer = null
  }

  if (frameIntegrityTimer !== null) {
    clearInterval(frameIntegrityTimer)
    frameIntegrityTimer = null
  }

  if (sessionCheckTimer !== null) {
    clearInterval(sessionCheckTimer)
    sessionCheckTimer = null
  }

  // -------------------------------------------------------------------------
  // Dispose face detector
  // -------------------------------------------------------------------------

  if (faceDetector) {
    try {
      faceDetector.close()
    } catch {
      // Ignore cleanup errors
    }

    faceDetector = null
  }

  // -------------------------------------------------------------------------
  // Dispose object detector
  // -------------------------------------------------------------------------

  if (objectDetector) {
    try {
      objectDetector.close()
    } catch {
      // Ignore cleanup errors
    }

    objectDetector = null
  }

  // -------------------------------------------------------------------------
  // Dispose face landmarker
  // -------------------------------------------------------------------------

  if (faceLandmarker) {
    try {
      faceLandmarker.close()
    } catch {
      // Ignore cleanup errors
    }

    faceLandmarker = null
  }

  // -------------------------------------------------------------------------
  // Reset temporal detector references
  // -------------------------------------------------------------------------

  presenceDetector = null
  objectPresenceDetector = null
  headOrientationDetector = null
  frameIntegrityDetector = null

  // -------------------------------------------------------------------------
  // Stop camera
  // -------------------------------------------------------------------------

  if (mediaStream) {
    for (
      const track of
      mediaStream.getTracks()
    ) {
      track.stop()
    }

    mediaStream = null
  }

  if (videoElement) {
    videoElement.srcObject = null
    videoElement = null
  }

  inferenceRunning = false
  objectInferenceRunning = false
  landmarkInferenceRunning = false
  frameIntegrityRunning = false
}

// ---------------------------------------------------------------------------
// MediaPipe FaceDetector initialisation
// ---------------------------------------------------------------------------

/**
 * Initialise MediaPipe FaceDetector.
 *
 * Returns the resolved MediaPipe WASM fileset so ObjectDetector can use
 * the same locally bundled runtime paths.
 */
async function initFaceDetector(): Promise<VisionFileset> {
  // WASM files are copied locally into the extension build.
  const wasmPath =
    chrome.runtime.getURL('wasm/')

  const vision =
    await FilesetResolver.forVisionTasks(
      wasmPath
    )

  // Face model is bundled locally
  const modelPath =
    chrome.runtime.getURL(
      'models/blaze_face_short_range.tflite'
    )

  faceDetector =
    await FaceDetector.createFromOptions(
      vision,
      {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
      }
    )

  console.log(
    '[ProctorAI Offscreen] MediaPipe FaceDetector ready'
  )

  return vision
}

// ---------------------------------------------------------------------------
// MediaPipe ObjectDetector initialisation
// ---------------------------------------------------------------------------

/**
 * Initialise MediaPipe ObjectDetector using the resolved WASM fileset.
 *
 * If ObjectDetector initialisation fails, the error propagates to
 * startCamera(), which fails monitoring startup cleanly.
 */
async function initObjectDetector(
  vision: VisionFileset
): Promise<void> {
  // Object model is bundled locally
  const modelPath =
    chrome.runtime.getURL(
      'models/efficientdet_lite0.tflite'
    )

  objectDetector =
    await ObjectDetector.createFromOptions(
      vision,
      {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        scoreThreshold: 0.25,
        maxResults: 10,
      }
    )

  console.log(
    '[ProctorAI Offscreen] MediaPipe ObjectDetector ready'
  )
}

// ---------------------------------------------------------------------------
// Face inference loop (~4 FPS)
// ---------------------------------------------------------------------------

function startInferenceLoop(): void {
  inferenceTimer = setInterval(() => {
    // Overlap protection
    if (inferenceRunning) {
      return
    }

    inferenceRunning = true

    try {
      runFaceInference()
    } catch (err) {
      // Detector errors are logged but NEVER interpreted as face_count=0
      console.debug(
        '[ProctorAI Offscreen] Face inference error:',
        err
      )
    } finally {
      inferenceRunning = false
    }
  }, SAMPLE_INTERVAL_MS)
}

function runFaceInference(): void {
  if (
    !videoElement ||
    !faceDetector ||
    !presenceDetector
  ) {
    return
  }

  // Video readiness guard
  if (videoElement.readyState < 2) {
    return
  }

  if (
    videoElement.videoWidth === 0 ||
    videoElement.videoHeight === 0
  ) {
    return
  }

  // Monotonically increasing timestamp for MediaPipe VIDEO mode
  const timestamp = performance.now()

  const result =
    faceDetector.detectForVideo(
      videoElement,
      timestamp
    )

  const faceCount =
    result.detections?.length ?? 0

  if (DEBUG_DETECTION) {
    console.debug(
      `[ProctorAI Face] faces=${faceCount}`
    )
  }

  const event =
    presenceDetector.processFrame(
      faceCount,
      Date.now()
    )

  if (event) {
    // Suppress no_face events when camera is confirmed obscured
    // to avoid redundant alerts. Other events pass through.
    if (
      event.event_type === 'no_face' &&
      frameIntegrityDetector?.isObscured()
    ) {
      if (DEBUG_DETECTION) {
        console.debug(
          '[ProctorAI Face] SUPPRESS no_face (camera obscured)'
        )
      }
    } else {
      if (DEBUG_DETECTION) {
        console.debug(
          `[ProctorAI Face] EMIT ${event.event_type}`
        )
      }

      sendFaceEventToServiceWorker(
        event
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Object inference loop (~5 FPS)
// ---------------------------------------------------------------------------

function startObjectInferenceLoop(): void {
  objectInferenceTimer = setInterval(
    () => {
      // Overlap protection
      if (objectInferenceRunning) {
        return
      }

      objectInferenceRunning = true

      try {
        runObjectInference()
      } catch (err) {
        // Detector errors are logged and ignored.
        // Never interpret an inference failure as a detection.
        console.debug(
          '[ProctorAI Offscreen] Object inference error:',
          err
        )
      } finally {
        objectInferenceRunning = false
      }
    },
    OBJECT_SAMPLE_INTERVAL_MS
  )
}

function runObjectInference(): void {
  if (
    !videoElement ||
    !objectDetector ||
    !objectPresenceDetector
  ) {
    return
  }

  // Video readiness guard
  if (videoElement.readyState < 2) {
    return
  }

  if (
    videoElement.videoWidth === 0 ||
    videoElement.videoHeight === 0
  ) {
    return
  }

  const timestamp = performance.now()

  const result =
    objectDetector.detectForVideo(
      videoElement,
      timestamp
    )

  // Simplified detector input.
  // We never transmit bounding boxes or frames.
  const input: ObjectSampleInput = {
    phoneDetected: false,
    phoneConfidence: 0,

    suspiciousDetected: false,
    suspiciousLabel: '',
    suspiciousConfidence: 0,
  }

  for (
    const detection of
    result.detections ?? []
  ) {
    const categories =
      detection.categories ?? []

    for (const cat of categories) {
      const label =
        cat.categoryName
          ?.toLowerCase()
          .trim() ?? ''

      const score =
        cat.score ?? 0

      // ---------------------------------------------------------------
      // Phone detection
      // ---------------------------------------------------------------

      if (label === PHONE_LABEL) {
        input.phoneDetected = true

        input.phoneConfidence =
          Math.max(
            input.phoneConfidence,
            score
          )

        continue
      }

      // ---------------------------------------------------------------
      // Suspicious object detection
      // ---------------------------------------------------------------

      if (
        PROHIBITED_OBJECT_LABELS.has(
          label
        )
      ) {
        input.suspiciousDetected =
          true

        // Keep the label associated with the highest-confidence
        // prohibited detection.
        if (
          score >=
          input.suspiciousConfidence
        ) {
          input.suspiciousLabel =
            label

          input.suspiciousConfidence =
            score
        }
      }
    }
  }

  if (DEBUG_DETECTION) {
    const phoneStr = input.phoneDetected
      ? `phone=true confidence=${input.phoneConfidence.toFixed(2)}`
      : 'phone=false'
    const suspStr = input.suspiciousDetected
      ? `suspicious=${input.suspiciousLabel} confidence=${input.suspiciousConfidence.toFixed(2)}`
      : 'suspicious=false'
    console.debug(`[ProctorAI Object] ${phoneStr} ${suspStr}`)
  }

  const events =
    objectPresenceDetector.processSample(
      input,
      Date.now()
    )

  for (const event of events) {
    if (DEBUG_DETECTION) {
      console.debug(
        `[ProctorAI Object] EMIT ${event.event_type} label=${event.metadata.object_label}`
      )
    }

    sendObjectEventToServiceWorker(
      event
    )
  }
}

// ---------------------------------------------------------------------------
// MediaPipe FaceLandmarker initialisation
// ---------------------------------------------------------------------------

/**
 * Initialise MediaPipe FaceLandmarker using the shared WASM fileset.
 *
 * If initialization fails, the error propagates to startCamera(),
 * which fails monitoring startup cleanly.
 */
async function initFaceLandmarker(
  vision: VisionFileset
): Promise<void> {
  const modelPath =
    chrome.runtime.getURL(
      'models/face_landmarker.task'
    )

  faceLandmarker =
    await FaceLandmarker.createFromOptions(
      vision,
      {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }
    )

  console.log(
    '[ProctorAI Offscreen] MediaPipe FaceLandmarker ready'
  )
}

// ---------------------------------------------------------------------------
// Frame integrity initialisation
// ---------------------------------------------------------------------------

/**
 * Create the offscreen canvas used for frame-integrity analysis.
 * The canvas downsamples the video frame to 32x24 for luminance statistics.
 * No frame data is ever retained or transmitted.
 */
function initFrameIntegrity(): void {
  integrityCanvas = new OffscreenCanvas(
    INTEGRITY_WIDTH,
    INTEGRITY_HEIGHT
  )

  integrityCtx = integrityCanvas.getContext('2d', {
    willReadFrequently: true,
  }) as OffscreenCanvasRenderingContext2D | null

  if (!integrityCtx) {
    throw new Error(
      'Failed to get 2D context for frame-integrity canvas'
    )
  }

  console.log(
    '[ProctorAI Offscreen] Frame integrity analyzer ready'
  )
}

// ---------------------------------------------------------------------------
// Landmark inference loop (~3 FPS)
// ---------------------------------------------------------------------------

function startLandmarkInferenceLoop(): void {
  landmarkInferenceTimer = setInterval(
    () => {
      // Overlap protection
      if (landmarkInferenceRunning) {
        return
      }

      landmarkInferenceRunning = true

      try {
        runLandmarkInference()
      } catch (err) {
        // Landmarker errors are logged but NEVER interpreted as looking_away
        console.debug(
          '[ProctorAI Offscreen] Landmark inference error:',
          err
        )
      } finally {
        landmarkInferenceRunning = false
      }
    },
    LANDMARK_SAMPLE_INTERVAL_MS
  )
}

/**
 * Run FaceLandmarker inference and estimate head orientation.
 *
 * Conditions where looking_away is NOT evaluated:
 * - no face detected (faceCount === 0)
 * - multiple faces detected
 * - FaceLandmarker result is invalid
 * - video frame is unavailable
 * - camera is confirmed obscured
 * - detector throws an error
 */
function runLandmarkInference(): void {
  if (
    !videoElement ||
    !faceLandmarker ||
    !headOrientationDetector ||
    !presenceDetector
  ) {
    return
  }

  if (videoElement.readyState < 2) {
    return
  }

  if (
    videoElement.videoWidth === 0 ||
    videoElement.videoHeight === 0
  ) {
    return
  }

  // Skip if camera is obscured — landmark results are unreliable
  if (frameIntegrityDetector?.isObscured()) {
    return
  }

  const timestamp = performance.now()

  const result = faceLandmarker.detectForVideo(
    videoElement,
    timestamp
  )

  // Require exactly one face for orientation estimation
  const faceCount = result.faceLandmarks?.length ?? 0

  if (faceCount !== 1) {
    // Cannot determine orientation — skip this sample
    return
  }

  const landmarks = result.faceLandmarks![0]

  if (!landmarks || landmarks.length < 264) {
    return
  }

  const orientation = estimateHeadOrientation(landmarks)

  if (DEBUG_DETECTION) {
    console.debug(
      `[ProctorAI Head] orientation=${orientation.orientation} away=${orientation.lookingAway}`
    )
  }

  const input: HeadSampleInput = {
    lookingAway: orientation.lookingAway,
    orientation: orientation.orientation,
  }

  const events = headOrientationDetector.processSample(
    input,
    Date.now()
  )

  for (const event of events) {
    if (DEBUG_DETECTION) {
      console.debug(
        `[ProctorAI Head] EMIT ${event.event_type} dir=${event.metadata.orientation}`
      )
    }

    sendLandmarkEventToServiceWorker(event)
  }
}

/**
 * Estimate head orientation from facial landmarks.
 *
 * Uses three stable landmarks:
 *   - Nose tip (index 1)
 *   - Left eye outer corner (index 33)
 *   - Right eye outer corner (index 263)
 *
 * Normalization:
 *   eyeCenterX = midpoint(leftEyeX, rightEyeX)
 *   eyeMidY    = midpoint(leftEyeY, rightEyeY)
 *   interEye   = abs(rightEyeX - leftEyeX)
 *
 *   yawNorm     = (noseX - eyeCenterX) / interEye
 *   verticalNorm = (noseY - eyeMidY) / interEye
 *
 * Thresholds:
 *   |yawNorm| > YAW_THRESHOLD (0.35) => left or right
 *   verticalNorm > DOWN_THRESHOLD (0.25) => down
 *   verticalNorm < UP_THRESHOLD (-0.15) => up
 */
function estimateHeadOrientation(
  landmarks: Array<{ x: number; y: number; z: number }>
): { lookingAway: boolean; orientation: 'forward' | 'left' | 'right' | 'down' | 'up' } {
  const noseTip = landmarks[LM_NOSE_TIP]
  const leftEye = landmarks[LM_LEFT_EYE_OUTER]
  const rightEye = landmarks[LM_RIGHT_EYE_OUTER]

  const eyeCenterX = (leftEye.x + rightEye.x) / 2
  const interEye = Math.abs(rightEye.x - leftEye.x)

  // Guard against degenerate geometry
  if (interEye < 0.01) {
    return { lookingAway: false, orientation: 'forward' }
  }

  const yawNorm = (noseTip.x - eyeCenterX) / interEye
  // Horizontal turn takes priority
  if (yawNorm > YAW_THRESHOLD) {
    return { lookingAway: true, orientation: 'right' }
  }

  if (yawNorm < -YAW_THRESHOLD) {
    return { lookingAway: true, orientation: 'left' }
  }

  return { lookingAway: false, orientation: 'forward' }
}

// ---------------------------------------------------------------------------
// Frame integrity inference loop (~2 FPS)
// ---------------------------------------------------------------------------

function startFrameIntegrityLoop(): void {
  frameIntegrityTimer = setInterval(
    () => {
      // Overlap protection
      if (frameIntegrityRunning) {
        return
      }

      frameIntegrityRunning = true

      try {
        runFrameIntegrity()
      } catch (err) {
        console.debug(
          '[ProctorAI Offscreen] Frame integrity error:',
          err
        )
      } finally {
        frameIntegrityRunning = false
      }
    },
    FRAME_INTEGRITY_INTERVAL_MS
  )
}

/**
 * Analyze the current video frame for obstruction.
 *
 * The frame is drawn onto a tiny offscreen canvas (32x24), then
 * luminance statistics are computed from the resulting pixel data.
 * Pixel data is immediately discarded after computing statistics.
 */
function runFrameIntegrity(): void {
  if (
    !videoElement ||
    !integrityCtx ||
    !frameIntegrityDetector
  ) {
    return
  }

  if (videoElement.readyState < 2) {
    return
  }

  if (
    videoElement.videoWidth === 0 ||
    videoElement.videoHeight === 0
  ) {
    return
  }

  // Draw the current video frame downsampled to 32x24
  integrityCtx.drawImage(
    videoElement,
    0,
    0,
    INTEGRITY_WIDTH,
    INTEGRITY_HEIGHT
  )

  const imageData = integrityCtx.getImageData(
    0,
    0,
    INTEGRITY_WIDTH,
    INTEGRITY_HEIGHT
  )

  const stats = analyzeFrameStats(imageData.data)

  if (DEBUG_DETECTION) {
    const obscured = classifyFrame(stats) !== null
    console.debug(
      `[ProctorAI Integrity] mean=${stats.meanLuminance.toFixed(0)} stddev=${stats.luminanceStddev.toFixed(0)} obscured=${obscured}`
    )
  }

  const events = frameIntegrityDetector.processSample(
    stats,
    Date.now()
  )

  for (const event of events) {
    if (DEBUG_DETECTION) {
      console.debug(
        `[ProctorAI Integrity] EMIT ${event.event_type} type=${event.metadata.obstruction_type}`
      )
    }

    sendIntegrityEventToServiceWorker(event)
  }
}

/**
 * Compute frame-integrity statistics from raw RGBA pixel data.
 *
 * Returns mean luminance, luminance standard deviation,
 * and ratios of very-dark and very-bright pixels.
 * No pixel data is retained after this function returns.
 */
function analyzeFrameStats(rgba: Uint8ClampedArray): FrameStatsInput {
  const pixelCount = rgba.length / 4
  let sumLum = 0
  let sumLumSq = 0
  let darkCount = 0
  let brightCount = 0

  for (let i = 0; i < rgba.length; i += 4) {
    // Perceived luminance from sRGB: ITU-R BT.601
    const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
    sumLum += lum
    sumLumSq += lum * lum

    if (lum < 15) {
      darkCount++
    }

    if (lum > 240) {
      brightCount++
    }
  }

const meanLuminance = sumLum / pixelCount
const variance = sumLumSq / pixelCount - meanLuminance * meanLuminance
const luminanceStddev = Math.sqrt(Math.max(0, variance))

  return {
    meanLuminance,
    luminanceStddev,
    darkPixelRatio: darkCount / pixelCount,
    brightPixelRatio: brightCount / pixelCount,
  }
}

// ---------------------------------------------------------------------------
// Session health check (every 15 seconds)
// ---------------------------------------------------------------------------

function startSessionCheckLoop(): void {
  sessionCheckTimer = setInterval(
    () => {
      chrome.runtime
        .sendMessage({
          target: 'service-worker',
          type:
            'CHECK_MONITORING_SESSION_STATUS',
        })
        .catch(() => {
          // Service worker may have suspended
        })
    },
    SESSION_CHECK_INTERVAL_MS
  )
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

function sendFaceEventToServiceWorker(
  event: FaceDetectorEvent
): void {
  chrome.runtime
    .sendMessage({
      target: 'service-worker',
      type: 'FACE_MONITORING_EVENT',
      event,
    })
    .catch(() => {
      // Service worker may have suspended
    })
}

function sendObjectEventToServiceWorker(
  event: ObjectDetectorEvent
): void {
  chrome.runtime
    .sendMessage({
      target: 'service-worker',
      type: 'OBJECT_MONITORING_EVENT',
      event,
    })
    .catch(() => {
      // Service worker may have suspended
    })
}

function sendLandmarkEventToServiceWorker(
  event: import('../camera/HeadOrientationDetector').HeadOrientationEvent
): void {
  chrome.runtime
    .sendMessage({
      target: 'service-worker',
      type: 'LANDMARK_MONITORING_EVENT',
      event,
    })
    .catch(() => {
      // Service worker may have suspended
    })
}

function sendIntegrityEventToServiceWorker(
  event: import('../camera/FrameIntegrityDetector').FrameIntegrityEvent
): void {
  chrome.runtime
    .sendMessage({
      target: 'service-worker',
      type: 'INTEGRITY_MONITORING_EVENT',
      event,
    })
    .catch(() => {
      // Service worker may have suspended
    })
}

function sendStatus(
  status: string
): void {
  chrome.runtime
    .sendMessage({
      target: 'service-worker',
      type: 'CAMERA_STATUS_UPDATE',
      status,
    })
    .catch(() => {
      // Service worker may have suspended
    })
}

// ---------------------------------------------------------------------------
// Message listener — commands from service worker / popup
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message,
    _sender,
    sendResponse
  ) => {
    if (
      message.target !==
      'offscreen'
    ) {
      return false
    }

    switch (message.type) {
      case 'START_CAMERA_MONITORING': {
        // Idempotent: only start if not already running or starting
        if (
          !running &&
          !starting
        ) {
          void startCamera()
        }

        sendResponse({
          ok: true,
        })

        break
      }

      case 'STOP_CAMERA_MONITORING': {
        stopCamera()

        sendResponse({
          ok: true,
        })

        break
      }

      case 'GET_CAMERA_STATUS': {
        sendResponse({
          running,
          starting,
          status: running
            ? 'active'
            : starting
              ? 'starting'
              : 'inactive',
        })

        break
      }

      case 'SESSION_STATUS_RESULT': {
        // Service worker replied with session status
        if (
          message.status !==
          'live'
        ) {
          console.log(
            `[ProctorAI Offscreen] Session no longer LIVE (${message.status}) — stopping camera`
          )

          stopCamera()
        }

        break
      }
    }

    return true
  }
)

// ---------------------------------------------------------------------------
// Cleanup on page unload
// ---------------------------------------------------------------------------

window.addEventListener(
  'beforeunload',
  () => {
    stopCamera()
  }
)