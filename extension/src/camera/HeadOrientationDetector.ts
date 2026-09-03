// ---------------------------------------------------------------------------
// ProctorAI — Head Orientation Temporal Detector (Phase 8)
// ---------------------------------------------------------------------------
//
// Pure-logic class that applies temporal persistence to head-orientation
// samples produced by the offscreen FaceLandmarker pipeline.
//
// INPUT — HeadSampleInput:
//   lookingAway: boolean     — whether the current frame shows abnormal orientation
//   orientation: string      — 'left' | 'right' | 'down' | 'up' (or 'forward')
//
// OUTPUT — HeadOrientationEvent[]:
//   Zero or one `looking_away` event per processSample() call.
//
// STATE MACHINE (per episode):
//   idle ──(abnormal ≥ THRESHOLD_MS)──> fired ──(forward ≥ RECOVERY_MS)──> idle
//
//   Brief glances (<THRESHOLD_MS) do NOT fire.
//   After firing, no duplicate events while abnormal persists.
//   Recovery requires continuous forward orientation for ≥RECOVERY_MS.
//
// STARTUP GRACE:
//   No events emitted during the first GRACE_MS after construction/reset.
// ---------------------------------------------------------------------------

/** Input for each head-orientation sample. */
export interface HeadSampleInput {
  /** true when the current frame shows head oriented noticeably away from camera. */
  lookingAway: boolean
  /** Cardinal direction the head is turned toward. */
  orientation: 'forward' | 'left' | 'right' | 'down' | 'up'
}

/** Emitted event when looking-away is confirmed. */
export interface HeadOrientationEvent {
  event_type: 'looking_away'
  /** Confidence: 1.0 for temporal confirmation. */
  confidence: number
  /** Unique ID for this event (caller generates). */
  client_event_id: string
  /** ISO timestamp when the event was confirmed. */
  client_occurred_at: string
  /** Safe metadata — no landmarks, no biometrics. */
  metadata: {
    source: 'mediapipe_face_landmarker'
    orientation: string
    persistence_ms: number
  }
}

// ---- Tuning constants (exported for tests) ----

/** Sustained abnormal orientation required before firing (ms). */
export const LOOKING_AWAY_THRESHOLD_MS = 1200

/** Continuous forward orientation required to re-arm (ms). */
export const LOOKING_AWAY_RECOVERY_MS = 1000

/** Startup grace period — no events during this window (ms). */
export const HEAD_GRACE_MS = 1500

// ---- Internal states ----

type HeadState = 'idle' | 'fired'

// ---------------------------------------------------------------------------

export class HeadOrientationDetector {
  private state: HeadState = 'idle'
  private abnormalStart: number | null = null
  private recoveryStart: number | null = null
  private lastOrientation: string = 'forward'
  private startTime: number

  constructor(startTime: number) {
    this.startTime = startTime
  }

  /**
   * Process a head-orientation sample and return any newly emitted events.
   *
   * @param input - Current sample from the FaceLandmarker pipeline
   * @param now - Current timestamp (ms, same clock as startTime)
   * @returns Array of 0 or 1 events
   */
  processSample(input: HeadSampleInput, now: number): HeadOrientationEvent[] {
    const events: HeadOrientationEvent[] = []

    // Track the last known orientation for metadata
    if (input.orientation !== 'forward') {
      this.lastOrientation = input.orientation
    }

    // ---- Startup grace ----
    if (now - this.startTime < HEAD_GRACE_MS) {
      return events
    }

    if (input.lookingAway) {
      // Cancel any ongoing recovery — head turned away again
      this.recoveryStart = null

      // Start abnormal streak if not already tracking
      if (this.abnormalStart === null) {
        this.abnormalStart = now
      }

      if (this.state !== 'fired') {
        const persistence = now - this.abnormalStart
        if (persistence >= LOOKING_AWAY_THRESHOLD_MS) {
          this.state = 'fired'
          events.push({
            event_type: 'looking_away',
            confidence: 1.0,
            client_event_id:
              `head_${now}_${Math.random().toString(36).slice(2, 8)}`,
            client_occurred_at: new Date(now).toISOString(),
            metadata: {
              source: 'mediapipe_face_landmarker',
              orientation: this.lastOrientation,
              persistence_ms: Math.round(persistence),
            },
          })
        }
      }
    } else {
      // Head is forward — handle recovery / reset abnormal tracking
      this.abnormalStart = null

      if (this.state === 'fired') {
        if (this.recoveryStart === null) {
          this.recoveryStart = now
        }
        if (now - this.recoveryStart >= LOOKING_AWAY_RECOVERY_MS) {
          this.state = 'idle'
          this.recoveryStart = null
        }
      } else {
        this.recoveryStart = null
      }
    }

    return events
  }

  /** Reset all internal state and restart the grace period. */
  reset(now: number): void {
    this.state = 'idle'
    this.abnormalStart = null
    this.recoveryStart = null
    this.lastOrientation = 'forward'
    // Restart grace by updating startTime
    this.startTime = now
  }
}
