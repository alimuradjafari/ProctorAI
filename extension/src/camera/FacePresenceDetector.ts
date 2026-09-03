/**
 * FacePresenceDetector — temporal persistence for face-presence anomalies.
 *
 * Pure logic class with no side effects. The caller drives it with
 * `processFrame(faceCount)` at ~2 FPS and consumes emitted events.
 *
 * Anomaly types:
 *   no_face       — face_count === 0 continuously for NO_FACE_THRESHOLD_MS
 *   multiple_faces — face_count >= 2  continuously for MULTI_FACE_THRESHOLD_MS
 *
 * Episode deduplication:
 *   After emitting an anomaly, the detector enters a "fired" state and
 *   will NOT emit another event of the same type until the session recovers
 *   (exactly one face continuously for RECOVERY_THRESHOLD_MS).
 *
 * Startup grace:
 *   The first GRACE_MS after construction are silent — no events emitted.
 */

// ---------------------------------------------------------------------------
// Thresholds (ms)
// ---------------------------------------------------------------------------

/** No-face must persist for at least this long before emitting. */
export const NO_FACE_THRESHOLD_MS = 1500

/** Multiple-faces must persist for at least this long before emitting. */
export const MULTI_FACE_THRESHOLD_MS = 750

/** Exactly-one-face must persist for this long to re-arm after an anomaly. */
export const RECOVERY_THRESHOLD_MS = 1500

/** Silent period after detector start — no events emitted. */
export const GRACE_MS = 1500

// ---------------------------------------------------------------------------
// Event shape
// ---------------------------------------------------------------------------

export interface FaceDetectorEvent {
  event_type: 'no_face' | 'multiple_faces'
  client_event_id: string
  client_occurred_at: string
  metadata: {
    source: 'mediapipe_face_detector'
    face_count: number
    persistence_ms: number
  }
}

// ---------------------------------------------------------------------------
// Detector state machine
// ---------------------------------------------------------------------------

type AnomalyState = 'idle' | 'fired'

export class FacePresenceDetector {
  // Streak tracking for no-face
  private noFaceStreakStart: number | null = null
  private noFaceState: AnomalyState = 'idle'

  // Streak tracking for multiple-faces
  private multiFaceStreakStart: number | null = null
  private multiFaceState: AnomalyState = 'idle'

  // Recovery tracking (exactly one face)
  private recoveryStreakStart: number | null = null

  // Startup grace — mutable so reset() can restart the grace window
  private startTime: number

  constructor(now: number = Date.now()) {
    this.startTime = now
  }

  /**
   * Process one detection sample.
   *
   * @param faceCount  Number of faces detected (0, 1, 2+)
   * @param now        Current timestamp (Date.now())
   * @returns          An emitted event, or null if no event should fire
   */
  processFrame(faceCount: number, now: number): FaceDetectorEvent | null {
    // ---- Startup grace period ----
    if (now - this.startTime < GRACE_MS) {
      return null
    }

    // ---- Recovery tracking: exactly one face re-arms fired detectors ----
    if (faceCount === 1) {
      if (this.recoveryStreakStart === null) {
        this.recoveryStreakStart = now
      }

      if (now - this.recoveryStreakStart >= RECOVERY_THRESHOLD_MS) {
        // Re-arm any fired detector
        if (this.noFaceState === 'fired') {
          this.noFaceState = 'idle'
        }
        if (this.multiFaceState === 'fired') {
          this.multiFaceState = 'idle'
        }
      }
    } else {
      // Non-one-face breaks recovery streak
      this.recoveryStreakStart = null
    }

    // ---- NO_FACE detection ----
    if (faceCount === 0) {
      if (this.noFaceStreakStart === null) {
        this.noFaceStreakStart = now
      }

      if (
        this.noFaceState !== 'fired' &&
        now - this.noFaceStreakStart >= NO_FACE_THRESHOLD_MS
      ) {
        this.noFaceState = 'fired'
        const persistenceMs = now - this.noFaceStreakStart
        this.noFaceStreakStart = null
        return this.buildEvent('no_face', 0, persistenceMs)
      }
    } else {
      // Non-zero breaks no-face streak
      this.noFaceStreakStart = null
    }

    // ---- MULTIPLE_FACES detection ----
    if (faceCount >= 2) {
      if (this.multiFaceStreakStart === null) {
        this.multiFaceStreakStart = now
      }

      if (
        this.multiFaceState !== 'fired' &&
        now - this.multiFaceStreakStart >= MULTI_FACE_THRESHOLD_MS
      ) {
        this.multiFaceState = 'fired'
        const persistenceMs = now - this.multiFaceStreakStart
        this.multiFaceStreakStart = null
        return this.buildEvent('multiple_faces', faceCount, persistenceMs)
      }
    } else {
      // <2 breaks multi-face streak
      this.multiFaceStreakStart = null
    }

    return null
  }

  /**
   * Reset all state (used when monitoring stops/restarts).
   * Restarts the startup grace period from `now`.
   */
  reset(now: number = Date.now()): void {
    this.noFaceStreakStart = null
    this.noFaceState = 'idle'
    this.multiFaceStreakStart = null
    this.multiFaceState = 'idle'
    this.recoveryStreakStart = null
    this.startTime = now
  }

  // ---- Private helpers ----

  private buildEvent(
    type: 'no_face' | 'multiple_faces',
    faceCount: number,
    persistenceMs: number
  ): FaceDetectorEvent {
    const prefix = type === 'no_face' ? 'no-face' : 'multiple-faces'
    return {
      event_type: type,
      client_event_id: `${prefix}-${crypto.randomUUID()}`,
      client_occurred_at: new Date().toISOString(),
      metadata: {
        source: 'mediapipe_face_detector',
        face_count: faceCount,
        persistence_ms: Math.round(persistenceMs),
      },
    }
  }
}
