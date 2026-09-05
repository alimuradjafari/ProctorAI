/**
 * ExamWindowFocusDetector — pure-logic tests (Phase 9.2)
 *
 * Run with:
 *   node node_modules/tsx/dist/cli.mjs --test src/browser/ExamWindowFocusDetector.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  ExamWindowFocusDetector,
  STARTUP_GRACE_MS,
  FOCUS_LOSS_CONFIRM_MS,
  FOCUS_RECOVERY_MS,
  type FocusSample,
} from './ExamWindowFocusDetector'

// ---- helpers ----

const T0 = 10_000

const exam: FocusSample = { destination: 'exam_window' }
const otherChrome: FocusSample = { destination: 'other_chrome_window' }
const outside: FocusSample = { destination: 'outside_chrome' }

/** Detector whose startup grace is already over, exam window focused. */
function armedDetector(): ExamWindowFocusDetector {
  const det = new ExamWindowFocusDetector(T0, true)
  det.processSample(exam, T0 + 2000) // post-grace, establishes 'focused'
  return det
}

/** Fire one confirmed episode and return its event. */
function fireEpisode(det: ExamWindowFocusDetector, at: number) {
  const t = T0 + at
  det.processSample(outside, t)
  const events = det.processSample(outside, t + FOCUS_LOSS_CONFIRM_MS)
  assert.equal(events.length, 1, 'episode must fire exactly one event')
  return events[0]
}

// ---------------------------------------------------------------------------

describe('ExamWindowFocusDetector', () => {
  it('1. exam window remains focused — no event', () => {
    const det = armedDetector()
    for (let t = 2100; t <= 6000; t += 250) {
      assert.equal(det.processSample(exam, T0 + t).length, 0)
    }
  })

  it('2. single away sample — no event', () => {
    const det = armedDetector()
    assert.equal(det.processSample(exam, T0 + 2100).length, 0)
    // One away sample, then no further samples — never confirmed
    assert.equal(det.processSample(outside, T0 + 2200).length, 0)
  })

  it('3. away < 500 ms — no event', () => {
    const det = armedDetector()
    det.processSample(outside, T0 + 2100)
    det.processSample(outside, T0 + 2400) // 300 ms — below threshold
    // Focus returns before confirmation — candidate cancelled
    assert.equal(det.processSample(exam, T0 + 2450).length, 0)
    // And stays focused — nothing pending
    assert.equal(det.processSample(exam, T0 + 3000).length, 0)
  })

  it('4. outside_chrome persists >= 500 ms — exactly one event', () => {
    const det = armedDetector()
    assert.equal(det.processSample(outside, T0 + 2100).length, 0)
    assert.equal(det.processSample(outside, T0 + 2350).length, 0)
    const events = det.processSample(outside, T0 + 2600) // 500 ms elapsed
    assert.equal(events.length, 1)
    assert.equal(events[0].event_type, 'exam_window_focus_lost')
    assert.equal(events[0].metadata.focus_destination, 'outside_chrome')
  })

  it('5. other_chrome_window persists >= 500 ms — exactly one event', () => {
    const det = armedDetector()
    det.processSample(otherChrome, T0 + 2100)
    det.processSample(otherChrome, T0 + 2350)
    const events = det.processSample(otherChrome, T0 + 2600)
    assert.equal(events.length, 1)
    assert.equal(events[0].metadata.focus_destination, 'other_chrome_window')
  })

  it('6. stays away after firing — no duplicate spam', () => {
    const det = armedDetector()
    fireEpisode(det, 2100)
    // Focus remains away for a long time — the episode is already reported
    for (let t = 2700; t <= 8000; t += 500) {
      assert.equal(det.processSample(outside, T0 + t).length, 0)
    }
  })

  it('7. return to exam < 1000 ms — not re-armed', () => {
    const det = armedDetector()
    fireEpisode(det, 2100)
    // Focus returns at 2700 — recovery starts
    det.processSample(exam, T0 + 2700)
    // Leaves again at 3300 (600 ms of focus — below recovery threshold):
    // back to fired, same episode, NO second event
    assert.equal(det.processSample(outside, T0 + 3300).length, 0)
    // And stays away — still no event
    assert.equal(det.processSample(outside, T0 + 5000).length, 0)
  })

  it('8. return >= 1000 ms — re-armed', () => {
    const det = armedDetector()
    fireEpisode(det, 2100)
    det.processSample(exam, T0 + 2700) // recovery starts
    // Away again at 4200: lazy recovery completion (1500 ms >= 1000) re-arms,
    // then this sample starts a NEW candidate
    det.processSample(outside, T0 + 4200)
    // Confirmed at 4700 — second event
    const events = det.processSample(outside, T0 + 4700)
    assert.equal(events.length, 1)
  })

  it('9. second focus-loss episode — second event', () => {
    const det = armedDetector()
    const first = fireEpisode(det, 2100)
    // Exam window focused continuously >= 1000 ms
    det.processSample(exam, T0 + 2800)
    det.processSample(exam, T0 + 4500)
    // Second episode
    const second = fireEpisode(det, 5000)
    assert.notEqual(second.client_event_id, first.client_event_id)
  })

  it('10. outside_chrome -> other_chrome_window during candidate — one continuous candidate', () => {
    const det = armedDetector()
    det.processSample(outside, T0 + 2100) // candidate starts
    // Destination changes mid-episode: timer NOT restarted, still away
    const events = det.processSample(otherChrome, T0 + 2600) // 500 ms since start
    assert.equal(events.length, 1)
    // Merged destination: the confirmed other-Chrome-window sighting wins
    assert.equal(events[0].metadata.focus_destination, 'other_chrome_window')
    // Persistence measured from the original candidate start
    assert.equal(events[0].metadata.persistence_ms, 500)
  })

  it('11. other_chrome_window -> outside_chrome after fired — no duplicate', () => {
    const det = armedDetector()
    det.processSample(otherChrome, T0 + 2100)
    assert.equal(det.processSample(otherChrome, T0 + 2600).length, 1)
    // Still the same episode, destination changed after firing
    assert.equal(det.processSample(outside, T0 + 3200).length, 0)
    assert.equal(det.processSample(outside, T0 + 4200).length, 0)
  })

  it('12. startup grace — no event', () => {
    const det = new ExamWindowFocusDetector(T0, true)
    assert.ok(STARTUP_GRACE_MS === 1500)
    // Focus lost during grace — candidate accrues but cannot fire yet
    assert.equal(det.processSample(outside, T0 + 200).length, 0)
    assert.equal(det.processSample(outside, T0 + 700).length, 0)
    assert.equal(det.processSample(outside, T0 + 1200).length, 0)
    // First post-grace sample confirms the episode (started at 200)
    const events = det.processSample(outside, T0 + 1700)
    assert.equal(events.length, 1)
    assert.equal(events[0].metadata.persistence_ms, 1500)
  })

  it('13. reset clears fired/candidate state', () => {
    // Reset while a candidate is pending
    const det = armedDetector()
    det.processSample(outside, T0 + 2100)
    assert.ok(det.isConfirming())
    det.reset(T0 + 9000, true)
    assert.equal(det.isConfirming(), false)

    // New episode after the new grace period fires normally
    assert.equal(det.processSample(outside, T0 + 11000).length, 0)
    const events = det.processSample(outside, T0 + 11500)
    assert.equal(events.length, 1)

    // Reset while fired: a pending episode is discarded, next one fires
    const det2 = armedDetector()
    fireEpisode(det2, 2100)
    det2.reset(T0 + 9000, true)
    assert.equal(det2.processSample(exam, T0 + 9100).length, 0)
    const events2 = fireEpisode(det2, 11000)
    assert.equal(events2.event_type, 'exam_window_focus_lost')
  })

  it('14. rapid transient focus changes — no event', () => {
    const det = armedDetector()
    // Flickering focus: each away period lasts well under 500 ms
    const seq: Array<[FocusSample, number]> = [
      [outside, 2100],
      [exam, 2180],
      [outside, 2260],
      [exam, 2340],
      [outside, 2420],
      [exam, 2500],
      [outside, 2580],
      [exam, 2660],
    ]
    for (const [sample, t] of seq) {
      assert.equal(det.processSample(sample, T0 + t).length, 0)
    }
  })

  it('15. recovery interrupted by focus loss — remains fired, no event', () => {
    const det = armedDetector()
    fireEpisode(det, 2100)
    det.processSample(exam, T0 + 2700) // recovery starts
    // Interrupted 400 ms in — below the 1000 ms recovery threshold
    assert.equal(det.processSample(outside, T0 + 3100).length, 0)
    // Stays away — episode already reported, no duplicates
    assert.equal(det.processSample(outside, T0 + 4100).length, 0)
    assert.equal(det.processSample(outside, T0 + 5100).length, 0)
  })

  it('16. metadata includes correct destination and persistence', () => {
    const det = armedDetector()
    det.processSample(otherChrome, T0 + 2100)
    const ev = det.processSample(otherChrome, T0 + 2720)[0]

    assert.equal(ev.event_type, 'exam_window_focus_lost')
    assert.equal(ev.metadata.source, 'chrome_windows_focus')
    assert.equal(ev.metadata.focus_destination, 'other_chrome_window')
    assert.equal(ev.metadata.persistence_ms, 620)
    // Exactly the three allowed metadata fields — nothing else leaks
    assert.deepEqual(
      Object.keys(ev.metadata).sort(),
      ['focus_destination', 'persistence_ms', 'source']
    )
    assert.ok(ev.client_event_id.startsWith('exam-window-focus-lost-'))
    assert.ok(!Number.isNaN(Date.parse(ev.client_occurred_at)))
  })

  // ---- Additional coverage beyond the spec minimum ----

  it('17. monitoring starts while unfocused — ONE event for the pre-existing episode', () => {
    const det = new ExamWindowFocusDetector(T0, false)
    // The student was already outside the exam window when monitoring began:
    // the episode is a candidate dated at startTime, so the SW's timer-chain
    // kick condition (isConfirming at construction) holds
    assert.ok(det.isConfirming())
    // Samples during grace accrue but cannot fire
    for (let t = 200; t <= 1400; t += 400) {
      assert.equal(det.processSample(outside, T0 + t).length, 0)
    }
    // First post-grace sample: persistence (from startTime) is past
    // confirmation — exactly ONE event fires
    const fired = det.processSample(outside, T0 + 2000)
    assert.equal(fired.length, 1)
    assert.equal(fired[0].event_type, 'exam_window_focus_lost')
    assert.equal(fired[0].metadata.focus_destination, 'outside_chrome')
    assert.equal(fired[0].metadata.persistence_ms, 2000)
    // Continued sampling of the same episode — no duplicates
    for (let t = 2400; t <= 4000; t += 400) {
      assert.equal(det.processSample(outside, T0 + t).length, 0)
    }
    assert.equal(det.isConfirming(), false)
    // Exam window regains focus, stays focused long enough to re-arm
    det.processSample(exam, T0 + 4400)
    det.processSample(exam, T0 + 5600) // lazy recovery completion (>= 1000 ms)
    // A genuinely NEW loss is detected normally
    const events = fireEpisode(det, 7000)
    assert.equal(events.event_type, 'exam_window_focus_lost')
  })

  it('17b. initial-away with early focus return — zero events, detector armed', () => {
    const det = new ExamWindowFocusDetector(T0, false)
    // Student returns to the exam window during grace, before the
    // pre-existing episode could be confirmed — candidate cancelled
    assert.equal(det.processSample(exam, T0 + 800).length, 0)
    assert.equal(det.isConfirming(), false)
    // Detector is armed: a genuinely NEW sustained loss fires normally
    const events = fireEpisode(det, 3000)
    assert.equal(events.event_type, 'exam_window_focus_lost')
  })

  it('18. isConfirming reflects candidate lifecycle for SW timer orchestration', () => {
    const det = armedDetector()
    assert.equal(det.isConfirming(), false)
    det.processSample(outside, T0 + 2100)
    assert.equal(det.isConfirming(), true) // candidate pending — timer chain runs
    det.processSample(outside, T0 + 2600) // fires
    assert.equal(det.isConfirming(), false) // fired — no more timer churn
    det.processSample(exam, T0 + 2700)
    assert.equal(det.isConfirming(), false) // recovering
    det.processSample(outside, T0 + 2800) // interrupted — fired
    assert.equal(det.isConfirming(), false)
  })

  it('19. recovery completes lazily even without intermediate focused samples', () => {
    const det = armedDetector()
    fireEpisode(det, 2100)
    // Focus returns at 2700 — exactly one sample, then silence for minutes
    det.processSample(exam, T0 + 2700)
    // Next sample is a NEW loss at 9000 (6300 ms later): lazy recovery
    // completion re-arms, this starts a fresh candidate
    assert.equal(det.processSample(outside, T0 + 9000).length, 0)
    const events = det.processSample(outside, T0 + 9500)
    assert.equal(events.length, 1)
    assert.equal(events[0].metadata.persistence_ms, FOCUS_LOSS_CONFIRM_MS)
    assert.equal(FOCUS_RECOVERY_MS, 1000)
  })
})
