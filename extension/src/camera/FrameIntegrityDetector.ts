// ---------------------------------------------------------------------------
// ProctorAI — Frame Integrity Temporal Detector (Phase 8)
// ---------------------------------------------------------------------------
//
// Pure-logic class that applies temporal persistence to frame-integrity
// statistics produced by the offscreen canvas downsampling pipeline.
//
// INPUT — FrameStatsInput:
//   meanLuminance: number     — average luminance of downsampled frame (0-255)
//   luminanceStddev: number   — standard deviation of luminance
//   darkPixelRatio: number    — fraction of pixels with luminance < 15 (0-1)
//   brightPixelRatio: number  — fraction of pixels with luminance > 240 (0-1)
//
// OUTPUT — FrameIntegrityEvent[]:
//   Zero or one `camera_obscured` event per processSample() call.
//
// OBSTRUCTION HEURISTICS:
//   dark_uniform:    meanLuminance < 20 AND stddev < 10
//   bright_uniform:  meanLuminance > 235 AND stddev < 10
//   low_variation:   stddev < 5 (extremely uniform regardless of brightness)
//
//   A frame is "abnormal" when ANY heuristic triggers.
//
// STATE MACHINE:
//   idle ──(abnormal ≥ THRESHOLD_MS)──> fired ──(normal ≥ RECOVERY_MS)──> idle
//
// STARTUP GRACE:
//   No events during first GRACE_MS after construction/reset.
// ---------------------------------------------------------------------------

/** Input statistics from frame-integrity analysis. */
export interface FrameStatsInput {
  /** Mean luminance of the downsampled frame (0–255). */
  meanLuminance: number
  /** Standard deviation of luminance values. */
  luminanceStddev: number
  /** Fraction of very-dark pixels (luminance < 15). Range 0–1. */
  darkPixelRatio: number
  /** Fraction of very-bright pixels (luminance > 240). Range 0–1. */
  brightPixelRatio: number
}

/** Emitted event when camera obstruction is confirmed. */
export interface FrameIntegrityEvent {
  event_type: 'camera_obscured'
  confidence: number
  client_event_id: string
  client_occurred_at: string
  metadata: {
    source: 'frame_integrity_analyzer'
    obstruction_type: string
    persistence_ms: number
    mean_luminance: number
    luminance_stddev: number
  }
}

// ---- Tuning constants (exported for tests) ----

/** Mean luminance below which a frame is considered dark. */
export const DARK_MEAN_THRESHOLD = 20

/** Mean luminance above which a frame is considered bright-obstructed. */
export const BRIGHT_MEAN_THRESHOLD = 235

/** Stddev below which a frame is considered uniform. */
export const UNIFORM_STDDEV_THRESHOLD = 10

/** Extremely low stddev — uniform regardless of brightness. */
export const EXTREME_UNIFORM_STDDEV = 5

/** Persistent abnormal duration required before firing (ms). */
export const OBSCURED_THRESHOLD_MS = 1000

/** Continuous normal frames required to re-arm (ms). */
export const OBSCURED_RECOVERY_MS = 1000

/** Startup grace period (ms). */
export const FRAME_GRACE_MS = 1500

// ---- Internal types ----

type ObscuredState = 'idle' | 'fired'

/**
 * Classify a frame's obstruction type.
 * Returns null if the frame appears normal.
 */
export function classifyFrame(stats: FrameStatsInput): string | null {
  // Dark uniform: very dark + low variation
  if (stats.meanLuminance < DARK_MEAN_THRESHOLD &&
      stats.luminanceStddev < UNIFORM_STDDEV_THRESHOLD) {
    return 'dark_uniform'
  }

  // Bright uniform: very bright + low variation
  if (stats.meanLuminance > BRIGHT_MEAN_THRESHOLD &&
      stats.luminanceStddev < UNIFORM_STDDEV_THRESHOLD) {
    return 'bright_uniform'
  }

  // Extreme uniform: very low variation regardless of brightness
  if (stats.luminanceStddev < EXTREME_UNIFORM_STDDEV) {
    return 'extreme_uniform'
  }

  return null
}

// ---------------------------------------------------------------------------

export class FrameIntegrityDetector {
  private state: ObscuredState = 'idle'
  private abnormalStart: number | null = null
  private recoveryStart: number | null = null
  private lastObstructionType: string = 'unknown'
  private startTime: number

  constructor(startTime: number) {
    this.startTime = startTime
  }

  /**
   * Process frame statistics and return any newly emitted events.
   *
   * @param stats - Downsampled frame statistics
   * @param now - Current timestamp (ms)
   * @returns Array of 0 or 1 events
   */
  processSample(stats: FrameStatsInput, now: number): FrameIntegrityEvent[] {
    const events: FrameIntegrityEvent[] = []

    const obstructionType = classifyFrame(stats)
    const isAbnormal = obstructionType !== null

    if (obstructionType) {
      this.lastObstructionType = obstructionType
    }

    // ---- Startup grace ----
    if (now - this.startTime < FRAME_GRACE_MS) {
      return events
    }

    if (isAbnormal) {
      // Cancel recovery
      this.recoveryStart = null

      if (this.abnormalStart === null) {
        this.abnormalStart = now
      }

      if (this.state !== 'fired') {
        const persistence = now - this.abnormalStart
        if (persistence >= OBSCURED_THRESHOLD_MS) {
          this.state = 'fired'
          events.push({
            event_type: 'camera_obscured',
            confidence: 1.0,
            client_event_id:
              `frame_${now}_${Math.random().toString(36).slice(2, 8)}`,
            client_occurred_at: new Date(now).toISOString(),
            metadata: {
              source: 'frame_integrity_analyzer',
              obstruction_type: this.lastObstructionType,
              persistence_ms: Math.round(persistence),
              mean_luminance: Math.round(stats.meanLuminance),
              luminance_stddev: Math.round(stats.luminanceStddev),
            },
          })
        }
      }
    } else {
      // Normal frame
      this.abnormalStart = null

      if (this.state === 'fired') {
        if (this.recoveryStart === null) {
          this.recoveryStart = now
        }
        if (now - this.recoveryStart >= OBSCURED_RECOVERY_MS) {
          this.state = 'idle'
          this.recoveryStart = null
        }
      } else {
        this.recoveryStart = null
      }
    }

    return events
  }

  /** Whether the camera is currently in a confirmed obscured state. */
  isObscured(): boolean {
    return this.state === 'fired'
  }

  /** Reset all state and restart grace period. */
  reset(now: number): void {
    this.state = 'idle'
    this.abnormalStart = null
    this.recoveryStart = null
    this.lastObstructionType = 'unknown'
    this.startTime = now
  }
}
