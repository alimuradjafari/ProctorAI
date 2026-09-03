/**
 * HeadOrientationDetector — pure-logic tests (Phase 8)
 *
 * Run with:
 *   node node_modules/tsx/dist/cli.mjs --test src/camera/HeadOrientationDetector.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  HeadOrientationDetector,
  LOOKING_AWAY_THRESHOLD_MS,
  LOOKING_AWAY_RECOVERY_MS,
  HEAD_GRACE_MS,
  type HeadSampleInput,
} from './HeadOrientationDetector'

// ---- helpers ----

const T0 = 10_000
const forward: HeadSampleInput = { lookingAway: false, orientation: 'forward' }
const left: HeadSampleInput = { lookingAway: true, orientation: 'left' }
const right: HeadSampleInput = { lookingAway: true, orientation: 'right' }

// ---------------------------------------------------------------------------

describe('HeadOrientationDetector', () => {
  it('1. forward orientation — no event', () => {
    const det = new HeadOrientationDetector(T0)
    const events = det.processSample(forward, T0 + HEAD_GRACE_MS + 500)
    assert.equal(events.length, 0)
  })

  it('2. one abnormal sample — no event', () => {
    const det = new HeadOrientationDetector(T0)
    const t = T0 + HEAD_GRACE_MS + 100
    const events = det.processSample(left, t)
    assert.equal(events.length, 0)
  })

  it('3. abnormal < threshold — no event', () => {
    const det = new HeadOrientationDetector(T0)
    const base = T0 + HEAD_GRACE_MS + 100
    const e1 = det.processSample(left, base)
    const e2 = det.processSample(left, base + 500)
    const e3 = det.processSample(left, base + LOOKING_AWAY_THRESHOLD_MS - 100)
    assert.equal(e1.length, 0)
    assert.equal(e2.length, 0)
    assert.equal(e3.length, 0)
  })

  it('4. abnormal >= threshold — exactly one looking_away', () => {
    const det = new HeadOrientationDetector(T0)
    const base = T0 + HEAD_GRACE_MS + 100
    det.processSample(left, base)
    det.processSample(left, base + 500)
    const events = det.processSample(left, base + LOOKING_AWAY_THRESHOLD_MS)
    assert.equal(events.length, 1)
    assert.equal(events[0].event_type, 'looking_away')
    assert.equal(events[0].metadata.source, 'mediapipe_face_landmarker')
    assert.equal(events[0].metadata.orientation, 'left')
    assert.ok(events[0].metadata.persistence_ms >= LOOKING_AWAY_THRESHOLD_MS)
  })

  it('5. continued abnormal — no spam', () => {
    const det = new HeadOrientationDetector(T0)
    const base = T0 + HEAD_GRACE_MS + 100
    det.processSample(left, base)
    det.processSample(left, base + LOOKING_AWAY_THRESHOLD_MS) // fires
    const e3 = det.processSample(left, base + LOOKING_AWAY_THRESHOLD_MS + 500)
    const e4 = det.processSample(left, base + LOOKING_AWAY_THRESHOLD_MS + 1000)
    assert.equal(e3.length, 0)
    assert.equal(e4.length, 0)
  })

  it('6. forward < recovery — remains fired', () => {
    const det = new HeadOrientationDetector(T0)
    const base = T0 + HEAD_GRACE_MS + 100
    det.processSample(left, base)
    det.processSample(left, base + LOOKING_AWAY_THRESHOLD_MS) // fires

    // Forward for less than recovery time
    const e = det.processSample(forward, base + LOOKING_AWAY_THRESHOLD_MS + 500)
    assert.equal(e.length, 0)

    // Still fires if we look away again immediately
    const e2 = det.processSample(left, base + LOOKING_AWAY_THRESHOLD_MS + 600)
    assert.equal(e2.length, 0) // no new event, already fired
  })

  it('7. forward >= recovery — re-arm', () => {
    const det = new HeadOrientationDetector(T0)
    const base = T0 + HEAD_GRACE_MS + 100
    det.processSample(left, base)
    det.processSample(left, base + LOOKING_AWAY_THRESHOLD_MS) // fires

    // Start recovery
    det.processSample(forward, base + LOOKING_AWAY_THRESHOLD_MS + 100)

    // Complete recovery (needs another forward sample after RECOVERY_MS)
    const e = det.processSample(
      forward,
      base + LOOKING_AWAY_THRESHOLD_MS + 100 + LOOKING_AWAY_RECOVERY_MS,
    )
    assert.equal(e.length, 0) // recovery itself doesn't emit

    // Now look away again — should fire a second event
    const secondBase = base + LOOKING_AWAY_THRESHOLD_MS + 100 + LOOKING_AWAY_RECOVERY_MS + 100
    det.processSample(left, secondBase)
    const e2 = det.processSample(left, secondBase + LOOKING_AWAY_THRESHOLD_MS)
    assert.equal(e2.length, 1)
    assert.equal(e2[0].event_type, 'looking_away')
  })

  it('8. second looking-away episode — second event', () => {
    const det = new HeadOrientationDetector(T0)
    const base = T0 + HEAD_GRACE_MS + 100

    // Episode 1
    det.processSample(left, base)
    const ev1 = det.processSample(left, base + LOOKING_AWAY_THRESHOLD_MS)
    assert.equal(ev1.length, 1)

    // Recovery
    const recStart = base + LOOKING_AWAY_THRESHOLD_MS + 100
    det.processSample(forward, recStart)
    det.processSample(forward, recStart + LOOKING_AWAY_RECOVERY_MS)

    // Episode 2 — different direction
    const ep2 = recStart + LOOKING_AWAY_RECOVERY_MS + 100
    det.processSample(right, ep2)
    const ev2 = det.processSample(right, ep2 + LOOKING_AWAY_THRESHOLD_MS)
    assert.equal(ev2.length, 1)
    assert.equal(ev2[0].metadata.orientation, 'right')
  })

  it('9. reset clears state and restarts grace', () => {
    const det = new HeadOrientationDetector(T0)
    const base = T0 + HEAD_GRACE_MS + 100

    // Fire an event
    det.processSample(left, base)
    det.processSample(left, base + LOOKING_AWAY_THRESHOLD_MS)

    // Reset
    const resetTime = base + LOOKING_AWAY_THRESHOLD_MS + 5000
    det.reset(resetTime)

    // Should be in grace — no events even if looking away
    const duringGrace = det.processSample(left, resetTime + 500)
    assert.equal(duringGrace.length, 0)

    // After grace — fresh start needed
    const afterGrace = resetTime + HEAD_GRACE_MS + 100
    det.processSample(left, afterGrace)
    const e = det.processSample(left, afterGrace + LOOKING_AWAY_THRESHOLD_MS)
    assert.equal(e.length, 1)
  })

  it('10. during startup grace — no events', () => {
    const det = new HeadOrientationDetector(T0)
    const duringGrace = T0 + 500
    const e1 = det.processSample(left, duringGrace)
    const e2 = det.processSample(left, duringGrace + 500)
    assert.equal(e1.length, 0)
    assert.equal(e2.length, 0)
  })

  it('11. recovery cancellation — head turns away during recovery', () => {
    const det = new HeadOrientationDetector(T0)
    const base = T0 + HEAD_GRACE_MS + 100

    // Fire
    det.processSample(left, base)
    det.processSample(left, base + LOOKING_AWAY_THRESHOLD_MS)

    // Start recovery
    det.processSample(forward, base + LOOKING_AWAY_THRESHOLD_MS + 100)

    // Turn away again BEFORE recovery completes — cancels recovery
    det.processSample(left, base + LOOKING_AWAY_THRESHOLD_MS + 500)

    // Continue forward — should need full recovery again
    const recStart2 = base + LOOKING_AWAY_THRESHOLD_MS + 600
    det.processSample(forward, recStart2)
    // Not yet recovered
    const e = det.processSample(forward, recStart2 + LOOKING_AWAY_RECOVERY_MS - 100)
    assert.equal(e.length, 0)

    // Now look away — should NOT fire (still in fired state, recovery was cancelled)
    const e2 = det.processSample(left, recStart2 + LOOKING_AWAY_RECOVERY_MS)
    assert.equal(e2.length, 0)
  })
})
