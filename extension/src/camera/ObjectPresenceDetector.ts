/**
 * ObjectPresenceDetector — temporal persistence for phone & suspicious-object anomalies.
 *
 * Pure logic class with no side effects. The caller drives it with
 * `processSample(input, now)` at ~5 FPS and consumes emitted events.
 *
 * Phone detection uses a **sliding observation window** instead of a continuous
 * streak, so a quick phone flash (~0.5-1 s) is caught reliably.
 *
 * Suspicious-object detection uses a short continuous-streak rule.
 *
 * Episode deduplication:
 *   After emitting, the detector enters "fired" state.  No duplicate events
 *   of the same type until the object is ABSENT continuously for REARM_MS.
 *
 * Startup grace:
 *   The first GRACE_MS after construction are silent — no events emitted.
 */

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Sliding window length for phone observation. */
export const PHONE_WINDOW_MS = 1000

/** Minimum qualifying phone hits within the window to confirm. */
export const PHONE_REQUIRED_HITS = 2

/** Minimum confidence for a phone sample to count as a qualifying hit. */
export const PHONE_NORMAL_CONFIDENCE = 0.40

/** High-confidence phone sample — used for the boosted single-strong rule. */
export const PHONE_HIGH_CONFIDENCE = 0.75

/** Very strong single detection threshold — can confirm with one follow-up hit. */
export const PHONE_BOOST_CONFIDENCE = 0.85

/** Suspicious object must persist for at least this long before emitting. */
export const SUSPICIOUS_THRESHOLD_MS = 1200

/** Object must be ABSENT continuously for this long to re-arm after firing. */
export const REARM_MS = 2000

/** Silent period after detector start — no events emitted. */
export const GRACE_MS = 1500

// ---------------------------------------------------------------------------
// Event shape
// ---------------------------------------------------------------------------

export interface ObjectDetectorEvent {
  event_type: 'phone_detected' | 'suspicious_object'
  client_event_id: string
  client_occurred_at: string
  confidence: number
  metadata: {
    source: 'mediapipe_object_detector'
    object_label: string
    confirmation_method: string
    observation_count: number
    window_ms: number
  }
}

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

export interface ObjectSampleInput {
  phoneDetected: boolean
  phoneConfidence: number
  suspiciousDetected: boolean
  suspiciousLabel: string
  suspiciousConfidence: number
}

// ---------------------------------------------------------------------------
// Phone observation for sliding window
// ---------------------------------------------------------------------------

interface PhoneObservation {
  timestamp: number
  confidence: number
}

// ---------------------------------------------------------------------------
// Detector state machine
// ---------------------------------------------------------------------------

type AnomalyState = 'idle' | 'fired'

export class ObjectPresenceDetector {
  // Phone sliding-window observations
  private phoneObservations: PhoneObservation[] = []
  private phoneState: AnomalyState = 'idle'
  private phoneRecoveryStart: number | null = null

  // Suspicious-object episode state (continuous streak)
  private suspiciousStreakStart: number | null = null
  private suspiciousState: AnomalyState = 'idle'
  private suspiciousMaxConfidence = 0
  private suspiciousRecoveryStart: number | null = null
  private suspiciousActiveLabel = ''

  // Startup grace — mutable so reset() can restart the grace window
  private startTime: number

  constructor(now: number = Date.now()) {
    this.startTime = now
  }

  /**
   * Process one object-detection sample.
   *
   * @param input  Simplified detection summary (phone + suspicious)
   * @param now    Current timestamp (Date.now())
   * @returns      Array of zero or more emitted events
   */
  processSample(input: ObjectSampleInput, now: number): ObjectDetectorEvent[] {
    // ---- Startup grace period ----
    if (now - this.startTime < GRACE_MS) {
      return []
    }

    const events: ObjectDetectorEvent[] = []

    // ================================================================
    // PHONE — sliding observation window
    // ================================================================

    if (input.phoneDetected && input.phoneConfidence >= PHONE_NORMAL_CONFIDENCE) {
      // Qualifying phone hit — cancel any recovery
      this.phoneRecoveryStart = null

      // Add observation
      this.phoneObservations.push({
        timestamp: now,
        confidence: input.phoneConfidence,
      })

      // Prune expired observations outside the window
      this.phoneObservations = this.phoneObservations.filter(
        (obs) => now - obs.timestamp <= PHONE_WINDOW_MS
      )

      // Evaluate confirmation (only if not already fired)
      if (this.phoneState !== 'fired') {
        const confirmed = this.evaluatePhoneConfirmation(now)

        if (confirmed) {
          this.phoneState = 'fired'

          const maxConf = Math.max(
            ...this.phoneObservations.map((o) => o.confidence)
          )

          const windowMs = this.phoneObservations.length >= 2
            ? now - this.phoneObservations[0].timestamp
            : 0

          events.push(this.buildPhoneEvent(
            maxConf,
            this.phoneObservations.length,
            Math.round(windowMs),
          ))

          // Clear observations — not needed while fired
          this.phoneObservations = []
        }
      }
    } else {
      // No qualifying phone detection this sample
      // Prune old observations
      this.phoneObservations = this.phoneObservations.filter(
        (obs) => now - obs.timestamp <= PHONE_WINDOW_MS
      )

      // Recovery: absent long enough to re-arm
      if (this.phoneState === 'fired') {
        if (this.phoneRecoveryStart === null) {
          this.phoneRecoveryStart = now
        }

        if (now - this.phoneRecoveryStart >= REARM_MS) {
          this.phoneState = 'idle'
          this.phoneRecoveryStart = null
          this.phoneObservations = []
        }
      }
    }

    // ================================================================
    // SUSPICIOUS OBJECT — continuous streak
    // ================================================================

    if (input.suspiciousDetected) {
      // Suspicious object present — break any recovery streak
      this.suspiciousRecoveryStart = null

      // Start or continue streak
      if (this.suspiciousStreakStart === null) {
        this.suspiciousStreakStart = now
        this.suspiciousMaxConfidence = input.suspiciousConfidence
        this.suspiciousActiveLabel = input.suspiciousLabel
      } else {
        this.suspiciousMaxConfidence = Math.max(
          this.suspiciousMaxConfidence,
          input.suspiciousConfidence,
        )
      }

      // Check threshold
      if (
        this.suspiciousState !== 'fired' &&
        now - this.suspiciousStreakStart >= SUSPICIOUS_THRESHOLD_MS
      ) {
        this.suspiciousState = 'fired'
        const persistenceMs = now - this.suspiciousStreakStart
        events.push(this.buildSuspiciousEvent(
          this.suspiciousActiveLabel,
          this.suspiciousMaxConfidence,
          Math.round(persistenceMs),
        ))
      }
    } else {
      // Suspicious object absent — break streak
      this.suspiciousStreakStart = null
      this.suspiciousMaxConfidence = 0

      // Recovery: absent long enough to re-arm
      if (this.suspiciousState === 'fired') {
        if (this.suspiciousRecoveryStart === null) {
          this.suspiciousRecoveryStart = now
        }

        if (now - this.suspiciousRecoveryStart >= REARM_MS) {
          this.suspiciousState = 'idle'
          this.suspiciousRecoveryStart = null
        }
      }
    }

    return events
  }

  /**
   * Reset all state (used when monitoring stops/restarts).
   * Restarts the startup grace period from `now`.
   */
  reset(now: number = Date.now()): void {
    this.phoneObservations = []
    this.phoneState = 'idle'
    this.phoneRecoveryStart = null

    this.suspiciousStreakStart = null
    this.suspiciousState = 'idle'
    this.suspiciousMaxConfidence = 0
    this.suspiciousRecoveryStart = null
    this.suspiciousActiveLabel = ''

    this.startTime = now
  }

  // ---- Private helpers ----

  /**
   * Evaluate whether the current phone observations confirm a phone_detected event.
   *
   * Rule A: >= PHONE_REQUIRED_HITS qualifying observations within PHONE_WINDOW_MS.
   * Rule B: one very strong detection (>= PHONE_BOOST_CONFIDENCE) and at least one
   *         other qualifying observation within the window.
   */
  private evaluatePhoneConfirmation(_now: number): boolean {
    const obs = this.phoneObservations

    if (obs.length < PHONE_REQUIRED_HITS) {
      return false
    }

    // Rule A: multi-hit window
    // (we already have >= REQUIRED_HITS within the window)
    return true

    // Note: Rule B is implicitly covered by Rule A since BOOST_CONFIDENCE >
    // NORMAL_CONFIDENCE, so a boost-level hit still counts as a qualifying hit.
    // With 2 hits required, even if one is boost-level, we still need a follow-up.
  }

  private buildPhoneEvent(
    confidence: number,
    observationCount: number,
    windowMs: number,
  ): ObjectDetectorEvent {
    return {
      event_type: 'phone_detected',
      client_event_id: `phone-detected-${crypto.randomUUID()}`,
      client_occurred_at: new Date().toISOString(),
      confidence: Math.min(1, Math.max(0, confidence)),
      metadata: {
        source: 'mediapipe_object_detector',
        object_label: 'cell phone',
        confirmation_method: 'multi_hit_window',
        observation_count: observationCount,
        window_ms: windowMs,
      },
    }
  }

  private buildSuspiciousEvent(
    label: string,
    confidence: number,
    persistenceMs: number,
  ): ObjectDetectorEvent {
    return {
      event_type: 'suspicious_object',
      client_event_id: `suspicious-object-${crypto.randomUUID()}`,
      client_occurred_at: new Date().toISOString(),
      confidence: Math.min(1, Math.max(0, confidence)),
      metadata: {
        source: 'mediapipe_object_detector',
        object_label: label,
        confirmation_method: 'continuous_streak',
        observation_count: 1,
        window_ms: persistenceMs,
      },
    }
  }
}
