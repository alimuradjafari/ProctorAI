// ---------------------------------------------------------------------------
// ProctorAI — Browser Side-Panel Detector (Phase 9.1)
// ---------------------------------------------------------------------------
//
// Pure TypeScript state machine that detects likely opening of browser side
// panels (e.g. Ask Gemini, bookmarks/reading panel, docked browser tools)
// using VIEWPORT GEOMETRY ONLY.
//
// PRIVACY: This detector observes only browser-window geometry numbers.
// It never inspects page content, text, prompts, AI responses, history,
// screenshots, or clipboard.
//
// DETECTION PRINCIPLE:
//   A side panel reduces window.innerWidth while window.outerWidth stays
//   approximately unchanged. A normal window resize changes both together.
//
// GEOMETRY METRICS:
//   inset          = outerWidth - innerWidth          (browser chrome width)
//   insetDelta     = currentInset - baselineInset     (panel width proxy)
//   innerWidthDelta= baselineInnerWidth - innerWidth  (content width loss)
//   shrinkRatio    = innerWidthDelta / baselineInnerWidth
//
// STATE MACHINE:
//   normal ──(suspicious sample)──> candidate
//   candidate ──(persists >= CONFIRM_MS)──> fired (emit ONE event)
//   fired ──(geometry normal)──> recovering
//   recovering ──(normal >= RECOVERY_MS)──> normal (re-armed)
//   recovering ──(suspicious again)──> fired (recovery cancelled, no event)
//
// RE-BASELINE MODE:
//   Entered when outerWidth changes significantly (>60px) or devicePixelRatio
//   changes (>0.05) — i.e. legitimate window resize / maximize / restore /
//   zoom change. After geometry is stable for ~750ms, the baseline is adopted
//   from the new dimensions. No event is ever emitted from re-baselining.
//
// STARTUP GRACE:
//   No events during the first GRACE_MS after construction/reset.
//
// No Chrome APIs. No DOM APIs. Fully unit-testable.
// ---------------------------------------------------------------------------

/** Geometry sample captured by the content script. */
export interface GeometrySample {
  outerWidth: number
  innerWidth: number
  visualViewportWidth?: number
  devicePixelRatio: number
}

/** Confirmed browser_side_panel monitoring event. */
export interface BrowserSidePanelEvent {
  event_type: 'browser_side_panel'
  client_event_id: string
  client_occurred_at: string
  metadata: {
    source: 'viewport_geometry'
    baseline_inner_width: number
    current_inner_width: number
    width_delta_px: number
    shrink_ratio: number
    baseline_outer_width: number
    current_outer_width: number
    inset_delta_px: number
    persistence_ms: number
  }
}

// ---- Tuning constants (exported for tests) ----

/** Startup grace — no events during this window (ms). */
export const STARTUP_GRACE_MS = 1500

/** Minimum content-width loss to consider a sample suspicious (px). */
export const SIDE_PANEL_MIN_DELTA_PX = 220

/** Minimum relative shrink to consider a sample suspicious (fraction). */
export const SIDE_PANEL_MIN_SHRINK_RATIO = 0.15

/** outerWidth may differ from baseline by this much and still be "stable". */
export const OUTER_WIDTH_STABLE_TOLERANCE_PX = 60

/** Suspicious geometry must persist this long before firing (ms). */
export const SIDE_PANEL_CONFIRM_MS = 500

/** Normal geometry must persist this long to re-arm after firing (ms). */
export const SIDE_PANEL_RECOVERY_MS = 1000

/** Geometry must be stable this long during re-baseline before adopting (ms). */
export const REBASELINE_STABLE_MS = 750

/** devicePixelRatio change above this is a zoom/environment change. */
export const DPR_CHANGE_TOLERANCE = 0.05

/** Per-sample jitter tolerated while judging re-baseline stability (px). */
const REBASELINE_JITTER_PX = 10

// ---- Internal state ----

type DetectorState = 'normal' | 'candidate' | 'fired' | 'recovering' | 'rebasing'

interface Baseline {
  outerWidth: number
  innerWidth: number
  visualViewportWidth: number | null
  devicePixelRatio: number
  inset: number
}

// ---------------------------------------------------------------------------

export class BrowserSidePanelDetector {
  private state: DetectorState = 'normal'
  private candidateStart: number | null = null
  private recoveryStart: number | null = null
  private rebaseStart: number | null = null
  private lastSample: GeometrySample | null = null
  private baseline: Baseline | null = null
  private startTime: number

  constructor(startTime: number) {
    this.startTime = startTime
  }

  /**
   * Process a geometry sample and return any newly confirmed events.
   *
   * @param sample - Current viewport geometry
   * @param now - Current timestamp (ms, same clock as startTime)
   * @returns Array of 0 or 1 events
   */
  processSample(sample: GeometrySample, now: number): BrowserSidePanelEvent[] {
    // ---- Sample validity ----
    // Invalid (zero/negative/degenerate) samples are safely ignored.
    if (
      !Number.isFinite(sample.outerWidth) ||
      !Number.isFinite(sample.innerWidth) ||
      !Number.isFinite(sample.devicePixelRatio) ||
      sample.outerWidth <= 0 ||
      sample.innerWidth <= 0 ||
      sample.innerWidth > sample.outerWidth ||
      sample.devicePixelRatio <= 0
    ) {
      return []
    }

    // ---- Baseline capture (first valid sample) ----
    if (this.baseline === null) {
      this.baseline = this.toBaseline(sample)
      this.lastSample = sample
      return []
    }

    const prevSample = this.lastSample
    this.lastSample = sample

    // ---- Re-baseline stability handling ----
    // Checked BEFORE the resize/zoom triggers: while re-baselining, geometry
    // legitimately differs from the OLD baseline, so stability must be judged
    // against the previous sample rather than the stale baseline.
    if (this.state === 'rebasing') {
      this.handleRebasingStability(sample, prevSample, now)
      return []
    }

    // ---- Zoom / devicePixelRatio change → re-baseline, never emit ----
    if (Math.abs(sample.devicePixelRatio - this.baseline.devicePixelRatio) > DPR_CHANGE_TOLERANCE) {
      this.enterRebasing()
      return []
    }

    // ---- Whole-window resize → re-baseline, never emit ----
    // CRITICAL FALSE-POSITIVE RULE: a legitimate resize of the whole browser
    // window changes outerWidth significantly and must NOT be reported as a
    // side panel.
    const outerDelta = Math.abs(sample.outerWidth - this.baseline.outerWidth)
    if (outerDelta > OUTER_WIDTH_STABLE_TOLERANCE_PX) {
      this.enterRebasing()
      return []
    }

    // ---- Startup grace — no events, no state advancement ----
    // Suspicious geometry during grace is ignored entirely; the candidate
    // clock only starts on the first post-grace sample, so an episode that
    // begins during grace is still confirmed (slightly later) instead of
    // being silently consumed by the grace window.
    if (now - this.startTime < STARTUP_GRACE_MS) {
      return []
    }

    // ---- Normal evaluation ----
    return this.advanceState(sample, now)
  }

  /** Reset all state and restart the startup grace. */
  reset(now: number): void {
    this.state = 'normal'
    this.candidateStart = null
    this.recoveryStart = null
    this.rebaseStart = null
    this.lastSample = null
    this.baseline = null
    this.startTime = now
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private toBaseline(sample: GeometrySample): Baseline {
    return {
      outerWidth: sample.outerWidth,
      innerWidth: sample.innerWidth,
      visualViewportWidth: sample.visualViewportWidth ?? null,
      devicePixelRatio: sample.devicePixelRatio,
      inset: sample.outerWidth - sample.innerWidth,
    }
  }

  private enterRebasing(): void {
    // Cancel any pending confirmation / recovery — geometry environment changed.
    this.state = 'rebasing'
    this.candidateStart = null
    this.recoveryStart = null
    this.rebaseStart = null // stability clock restarts on next sample
  }

  /**
   * While re-baselining: require consecutive stable samples for
   * REBASELINE_STABLE_MS, then adopt the current geometry as new baseline.
   */
  private handleRebasingStability(
    sample: GeometrySample,
    prev: GeometrySample | null,
    now: number
  ): void {
    if (prev === null) {
      this.rebaseStart = now
      return
    }

    const stable =
      Math.abs(sample.outerWidth - prev.outerWidth) <= REBASELINE_JITTER_PX &&
      Math.abs(sample.innerWidth - prev.innerWidth) <= REBASELINE_JITTER_PX &&
      Math.abs(sample.devicePixelRatio - prev.devicePixelRatio) <= DPR_CHANGE_TOLERANCE

    if (!stable) {
      this.rebaseStart = now
      return
    }

    if (this.rebaseStart === null) {
      this.rebaseStart = now
      return
    }

    if (now - this.rebaseStart >= REBASELINE_STABLE_MS) {
      // Adopt the new normal dimensions.
      this.baseline = this.toBaseline(sample)
      this.state = 'normal'
      this.candidateStart = null
      this.recoveryStart = null
      this.rebaseStart = null
    }
  }

  /**
   * Advance the normal/candidate/fired/recovering state machine.
   */
  private advanceState(
    sample: GeometrySample,
    now: number
  ): BrowserSidePanelEvent[] {
    const baseline = this.baseline!
    const suspicious = this.isSuspicious(sample, baseline)

    if (suspicious) {
      // Suspicious geometry cancels any recovery in progress.
      this.recoveryStart = null

      if (this.state === 'normal') {
        this.state = 'candidate'
        this.candidateStart = now
      } else if (this.state === 'candidate') {
        if (this.candidateStart !== null &&
            now - this.candidateStart >= SIDE_PANEL_CONFIRM_MS) {
          const persistenceMs = now - this.candidateStart
          this.state = 'fired'
          this.candidateStart = null
          return [this.buildEvent(sample, baseline, now, persistenceMs)]
        }
      }
      // 'fired' or 'recovering' → stay fired without duplicate events.
      if (this.state === 'recovering') {
        this.state = 'fired'
      }
    } else {
      // Normal geometry resets candidate tracking.
      this.candidateStart = null

      if (this.state === 'candidate') {
        this.state = 'normal'
      } else if (this.state === 'fired') {
        this.state = 'recovering'
        this.recoveryStart = now
      } else if (this.state === 'recovering') {
        if (this.recoveryStart !== null &&
            now - this.recoveryStart >= SIDE_PANEL_RECOVERY_MS) {
          this.state = 'normal'
          this.recoveryStart = null
        }
      }
    }

    return []
  }

  /**
   * A sample is suspicious when:
   *   1. outerWidth is approximately unchanged vs baseline (within 60px), AND
   *   2. content-width loss >= 220px, AND
   *   3. shrink ratio >= 0.15
   */
  private isSuspicious(sample: GeometrySample, baseline: Baseline): boolean {
    const outerStable =
      Math.abs(sample.outerWidth - baseline.outerWidth) <=
      OUTER_WIDTH_STABLE_TOLERANCE_PX

    if (!outerStable) {
      return false
    }

    const innerWidthDelta = baseline.innerWidth - sample.innerWidth

    if (innerWidthDelta < SIDE_PANEL_MIN_DELTA_PX) {
      return false
    }

    const shrinkRatio = innerWidthDelta / baseline.innerWidth

    return shrinkRatio >= SIDE_PANEL_MIN_SHRINK_RATIO
  }

  private buildEvent(
    sample: GeometrySample,
    baseline: Baseline,
    now: number,
    persistenceMs: number
  ): BrowserSidePanelEvent {
    const innerWidthDelta = baseline.innerWidth - sample.innerWidth
    const shrinkRatio = innerWidthDelta / baseline.innerWidth
    const currentInset = sample.outerWidth - sample.innerWidth
    const insetDelta = currentInset - baseline.inset

    return {
      event_type: 'browser_side_panel',
      client_event_id:
        `browser-side-panel-${now}-${Math.random().toString(36).slice(2, 8)}`,
      client_occurred_at: new Date(now).toISOString(),
      metadata: {
        source: 'viewport_geometry',
        baseline_inner_width: Math.round(baseline.innerWidth),
        current_inner_width: Math.round(sample.innerWidth),
        width_delta_px: Math.round(innerWidthDelta),
        shrink_ratio: Math.round(shrinkRatio * 1000) / 1000,
        baseline_outer_width: Math.round(baseline.outerWidth),
        current_outer_width: Math.round(sample.outerWidth),
        inset_delta_px: Math.round(insetDelta),
        persistence_ms: Math.round(persistenceMs),
      },
    }
  }
}
