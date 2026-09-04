// ---------------------------------------------------------------------------
// ProctorAI — Exam Window Focus Detector (Phase 9.2)
// ---------------------------------------------------------------------------
//
// Pure TypeScript state machine that detects when the monitored EXAM browser
// window loses operating-system / browser focus for a sustained period.
//
// PRIVACY: This detector observes ONLY which window holds browser focus
// (exam window / other Chrome window / outside Chrome). It never inspects
// application names, processes, window titles, URLs, keystrokes, the Alt key,
// the clipboard, the desktop, or screenshots — and it does NOT attempt to
// identify what the student switched to.
//
// INPUT (fed by the service worker from chrome.windows.onFocusChanged):
//   windowId === examWindowId            -> 'exam_window'
//   windowId === WINDOW_ID_NONE          -> 'outside_chrome'
//   any other valid Chrome window ID     -> 'other_chrome_window'
//
// STATE MACHINE:
//   focused ──(focus leaves exam window)──> candidate
//   candidate ──(persists >= CONFIRM_MS)──> fired (emit ONE event)
//   fired ──(exam window focused again)──> recovering
//   recovering ──(focused >= RECOVERY_MS)──> focused (re-armed)
//   recovering ──(focus leaves again)──> fired (no event — same episode)
//
// DESTINATION CHANGES WHILE AWAY:
//   Chrome often transitions through WINDOW_ID_NONE while switching between
//   its own windows. Destination changes during one continuous focus-loss
//   episode do NOT restart the confirmation timer. The reported destination
//   merges observations with priority other_chrome_window > outside_chrome
//   (a confirmed other-Chrome-window sighting is the more meaningful signal;
//   WINDOW_ID_NONE alone may be a transient).
//
// STARTUP GRACE:
//   State advances during grace but no event is emitted until grace expires,
//   so a focus loss that begins during grace is still confirmed (slightly
//   later) instead of being silently swallowed. This matters because focus
//   samples are event-driven — a swallowed candidate would receive no further
//   samples to recover from.
//
// LAZY RECOVERY COMPLETION:
//   Recovery is completed on the NEXT sample if >= RECOVERY_MS has elapsed,
//   whatever that sample is. Focus returning produces exactly one sample and
//   then silence, so re-arming must be evaluated lazily when the next focus
//   change arrives — even if that next change is a new focus loss.
//
// No Chrome APIs. No DOM APIs. Fully unit-testable.
// ---------------------------------------------------------------------------

/** Where browser focus currently is, relative to the exam window. */
export type FocusDestination =
  | 'exam_window'
  | 'other_chrome_window'
  | 'outside_chrome'

/** Focus sample produced by the service worker for each focus change. */
export interface FocusSample {
  destination: FocusDestination
}

/** Confirmed exam_window_focus_lost monitoring event. */
export interface ExamWindowFocusEvent {
  event_type: 'exam_window_focus_lost'
  client_event_id: string
  client_occurred_at: string
  metadata: {
    source: 'chrome_windows_focus'
    focus_destination: 'other_chrome_window' | 'outside_chrome'
    persistence_ms: number
  }
}

// ---- Tuning constants (exported for tests) ----

/** Startup grace — no events during this window (ms). */
export const STARTUP_GRACE_MS = 1500

/** Focus must remain away this long before firing (ms). */
export const FOCUS_LOSS_CONFIRM_MS = 500

/** Exam window must be focused this long to re-arm after firing (ms). */
export const FOCUS_RECOVERY_MS = 1000

// ---- Internal state ----

type DetectorState = 'focused' | 'candidate' | 'fired' | 'recovering'

// ---------------------------------------------------------------------------

export class ExamWindowFocusDetector {
  private state: DetectorState = 'focused'
  private candidateStart: number | null = null
  private recoveryStart: number | null = null
  private awayDestination: Exclude<FocusDestination, 'exam_window'> | null = null
  private startTime: number

  /**
   * @param startTime - Detector start timestamp (ms)
   * @param initiallyFocused - Whether the exam window actually had focus
   *   when monitoring started. When false, the detector starts in the
   *   'fired' state: the pre-existing focus-loss episode predates monitoring
   *   and is never reported — a new episode is only detected after the exam
   *   window regains focus and the detector re-arms.
   */
  constructor(startTime: number, initiallyFocused: boolean) {
    this.startTime = startTime
    this.init(initiallyFocused)
  }

  /**
   * Process a focus sample and return any newly confirmed events.
   *
   * @param sample - Current focus destination
   * @param now - Current timestamp (ms, same clock as startTime)
   * @returns Array of 0 or 1 events
   */
  processSample(sample: FocusSample, now: number): ExamWindowFocusEvent[] {
    // ---- Lazy recovery completion ----
    // Focus returning produces exactly one sample and then silence, so the
    // re-arm check must run on whatever sample arrives next — including a
    // new focus loss. Without this, a second episode minutes later would be
    // swallowed by stale 'recovering' state.
    if (
      this.state === 'recovering' &&
      this.recoveryStart !== null &&
      now - this.recoveryStart >= FOCUS_RECOVERY_MS
    ) {
      this.state = 'focused'
      this.recoveryStart = null
    }

    const duringGrace = now - this.startTime < STARTUP_GRACE_MS

    // ---- Exam window focused ----
    if (sample.destination === 'exam_window') {
      if (this.state === 'candidate') {
        // Focus returned before confirmation — candidate cancelled.
        this.state = 'focused'
        this.candidateStart = null
        this.awayDestination = null
      } else if (this.state === 'fired') {
        this.state = 'recovering'
        this.recoveryStart = now
      }
      // 'focused' stays focused; 'recovering' completes lazily on a later sample.

      return []
    }

    // ---- Focus away (narrowed to the two away destinations) ----
    const away = sample.destination

    // Any focus loss cancels an in-progress recovery (same episode).
    this.recoveryStart = null

    if (this.state === 'focused') {
      this.state = 'candidate'
      this.candidateStart = now
      this.awayDestination = away
      return []
    }

    if (this.state === 'candidate') {
      // Destination changes do not restart the confirmation clock —
      // it is still one continuous focus-loss episode.
      this.awayDestination = mergeDestinations(this.awayDestination, away)

      if (duringGrace) {
        // Candidate accrues time but cannot fire during grace.
        return []
      }

      if (
        this.candidateStart !== null &&
        now - this.candidateStart >= FOCUS_LOSS_CONFIRM_MS
      ) {
        const persistenceMs = now - this.candidateStart
        const destination = this.awayDestination
        this.state = 'fired'
        this.candidateStart = null
        return [this.buildEvent(destination, now, persistenceMs)]
      }
      return []
    }

    if (this.state === 'recovering') {
      // Recovery interrupted before re-arm — back to fired, no event:
      // this episode was already reported.
      this.state = 'fired'
      return []
    }

    // 'fired' — keep merging the observed destination for accuracy.
    this.awayDestination = mergeDestinations(this.awayDestination, away)
    return []
  }

  /**
   * Whether a focus-loss candidate is pending confirmation. The service
   * worker uses this to keep its confirmation timer chain running while the
   * detector is away — sustained focus loss produces no further Chrome
   * events, so the detector needs synthetic samples over time.
   */
  isConfirming(): boolean {
    return this.state === 'candidate'
  }

  /** Reset all state, restart the startup grace, and re-seed focus state. */
  reset(now: number, initiallyFocused: boolean): void {
    this.startTime = now
    this.init(initiallyFocused)
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private init(initiallyFocused: boolean): void {
    this.candidateStart = null
    this.recoveryStart = null
    this.awayDestination = null
    this.state = initiallyFocused ? 'focused' : 'fired'
  }

  private buildEvent(
    destination: Exclude<FocusDestination, 'exam_window'>,
    now: number,
    persistenceMs: number
  ): ExamWindowFocusEvent {
    return {
      event_type: 'exam_window_focus_lost',
      client_event_id:
        `exam-window-focus-lost-${now}-${Math.random().toString(36).slice(2, 8)}`,
      client_occurred_at: new Date(now).toISOString(),
      metadata: {
        source: 'chrome_windows_focus',
        focus_destination: destination,
        persistence_ms: Math.round(persistenceMs),
      },
    }
  }
}

/**
 * Merge two away-destinations observed within one continuous focus-loss
 * episode. Priority: other_chrome_window > outside_chrome — WINDOW_ID_NONE
 * frequently appears as a transient while Chrome switches between its own
 * windows, so a confirmed other-Chrome-window sighting wins.
 */
function mergeDestinations(
  current: Exclude<FocusDestination, 'exam_window'> | null,
  observed: Exclude<FocusDestination, 'exam_window'>
): Exclude<FocusDestination, 'exam_window'> {
  if (current === null) {
    return observed
  }
  if (current === 'other_chrome_window' || observed === 'other_chrome_window') {
    return 'other_chrome_window'
  }
  return 'outside_chrome'
}
