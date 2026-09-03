/**
 * Focused pure-logic tests for ObjectPresenceDetector.
 *
 * Run with:  npx tsx src/camera/ObjectPresenceDetector.test.ts
 *
 * These tests verify the sliding-window phone detection and suspicious-object
 * streak logic without any Chrome or MediaPipe dependencies.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  ObjectPresenceDetector,
  PHONE_WINDOW_MS,
  PHONE_REQUIRED_HITS,
  PHONE_NORMAL_CONFIDENCE,
  PHONE_BOOST_CONFIDENCE,
  SUSPICIOUS_THRESHOLD_MS,
  REARM_MS,
  GRACE_MS,
} from './ObjectPresenceDetector'
import type { ObjectSampleInput } from './ObjectPresenceDetector'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function phoneHit(confidence = 0.6): ObjectSampleInput {
  return {
    phoneDetected: true,
    phoneConfidence: confidence,
    suspiciousDetected: false,
    suspiciousLabel: '',
    suspiciousConfidence: 0,
  }
}

function noDetection(): ObjectSampleInput {
  return {
    phoneDetected: false,
    phoneConfidence: 0,
    suspiciousDetected: false,
    suspiciousLabel: '',
    suspiciousConfidence: 0,
  }
}

function suspiciousHit(label = 'book', confidence = 0.6): ObjectSampleInput {
  return {
    phoneDetected: false,
    phoneConfidence: 0,
    suspiciousDetected: true,
    suspiciousLabel: label,
    suspiciousConfidence: confidence,
  }
}

// ---------------------------------------------------------------------------
// Phone tests
// ---------------------------------------------------------------------------

describe('ObjectPresenceDetector — Phone', () => {
  it('1. single phone hit → no event', () => {
    const det = new ObjectPresenceDetector(0)
    const now = GRACE_MS + 100
    const events = det.processSample(phoneHit(0.6), now)
    assert.equal(events.length, 0)
  })

  it('2. two qualifying hits within window → one phone_detected', () => {
    const det = new ObjectPresenceDetector(0)
    const t0 = GRACE_MS + 100
    det.processSample(phoneHit(0.6), t0)
    const events = det.processSample(phoneHit(0.7), t0 + 300)
    assert.equal(events.length, 1)
    assert.equal(events[0].event_type, 'phone_detected')
    assert.equal(events[0].metadata.object_label, 'cell phone')
    assert.equal(events[0].metadata.confirmation_method, 'multi_hit_window')
  })

  it('3. two hits more than window apart → no event', () => {
    const det = new ObjectPresenceDetector(0)
    const t0 = GRACE_MS + 100
    det.processSample(phoneHit(0.6), t0)
    // Second hit just outside the window
    const events = det.processSample(phoneHit(0.7), t0 + PHONE_WINDOW_MS + 100)
    assert.equal(events.length, 0)
  })

  it('4. continued phone detections after event → no duplicate', () => {
    const det = new ObjectPresenceDetector(0)
    const t0 = GRACE_MS + 100
    det.processSample(phoneHit(0.6), t0)
    const e1 = det.processSample(phoneHit(0.7), t0 + 300)
    assert.equal(e1.length, 1)

    // Continue detecting phone
    const e2 = det.processSample(phoneHit(0.8), t0 + 500)
    assert.equal(e2.length, 0)
    const e3 = det.processSample(phoneHit(0.6), t0 + 700)
    assert.equal(e3.length, 0)
  })

  it('5. phone absent < REARM_MS → not re-armed', () => {
    const det = new ObjectPresenceDetector(0)
    const t0 = GRACE_MS + 100
    det.processSample(phoneHit(0.6), t0)
    det.processSample(phoneHit(0.7), t0 + 300) // fires

    // Start recovery
    det.processSample(noDetection(), t0 + 300 + 100)
    // Less than REARM_MS later — still fired
    const e = det.processSample(phoneHit(0.6), t0 + 300 + 100 + REARM_MS - 200)
    // Phone detected again during recovery → cancels recovery, but state is still fired
    assert.equal(e.length, 0)
  })

  it('6. phone absent >= REARM_MS → re-armed', () => {
    const det = new ObjectPresenceDetector(0)
    const t0 = GRACE_MS + 100
    det.processSample(phoneHit(0.6), t0)
    det.processSample(phoneHit(0.7), t0 + 300) // fires

    // Start recovery at t0 + 400
    det.processSample(noDetection(), t0 + 400)
    // End recovery after REARM_MS
    det.processSample(noDetection(), t0 + 400 + REARM_MS + 100)

    // Now re-armed — two new hits should fire
    const t1 = t0 + 400 + REARM_MS + 200
    det.processSample(phoneHit(0.6), t1)
    const events = det.processSample(phoneHit(0.7), t1 + 300)
    assert.equal(events.length, 1)
    assert.equal(events[0].event_type, 'phone_detected')
  })

  it('7. second episode → second phone_detected', () => {
    const det = new ObjectPresenceDetector(0)
    const t0 = GRACE_MS + 100

    // Episode 1
    det.processSample(phoneHit(0.6), t0)
    const e1 = det.processSample(phoneHit(0.7), t0 + 300)
    assert.equal(e1.length, 1)

    // Start recovery
    det.processSample(noDetection(), t0 + 400)
    // End recovery after REARM_MS
    det.processSample(noDetection(), t0 + 400 + REARM_MS + 100)

    // Episode 2
    const t2 = t0 + 400 + REARM_MS + 200
    det.processSample(phoneHit(0.65), t2)
    const e2 = det.processSample(phoneHit(0.75), t2 + 250)
    assert.equal(e2.length, 1)
    assert.equal(e2[0].event_type, 'phone_detected')
  })

  it('8. low confidence below threshold → does not count', () => {
    const det = new ObjectPresenceDetector(0)
    const t0 = GRACE_MS + 100
    // Below PHONE_NORMAL_CONFIDENCE
    det.processSample(phoneHit(PHONE_NORMAL_CONFIDENCE - 0.1), t0)
    det.processSample(phoneHit(PHONE_NORMAL_CONFIDENCE - 0.05), t0 + 300)
    const events = det.processSample(phoneHit(PHONE_NORMAL_CONFIDENCE - 0.1), t0 + 500)
    assert.equal(events.length, 0)
  })

  it('9. intermittent: hit → miss → hit within window → can confirm', () => {
    const det = new ObjectPresenceDetector(0)
    const t0 = GRACE_MS + 100
    det.processSample(phoneHit(0.6), t0)
    det.processSample(noDetection(), t0 + 200) // one miss
    // Second hit still within window
    const events = det.processSample(phoneHit(0.7), t0 + 400)
    assert.equal(events.length, 1)
    assert.equal(events[0].event_type, 'phone_detected')
  })
})

// ---------------------------------------------------------------------------
// Suspicious object tests
// ---------------------------------------------------------------------------

describe('ObjectPresenceDetector — Suspicious Object', () => {
  it('short detection → no event', () => {
    const det = new ObjectPresenceDetector(0)
    const t0 = GRACE_MS + 100
    det.processSample(suspiciousHit(), t0)
    const events = det.processSample(suspiciousHit(), t0 + 500)
    assert.equal(events.length, 0)
  })

  it('persistent >= SUSPICIOUS_THRESHOLD_MS → one event', () => {
    const det = new ObjectPresenceDetector(0)
    const t0 = GRACE_MS + 100
    det.processSample(suspiciousHit('book', 0.6), t0)
    det.processSample(suspiciousHit('book', 0.7), t0 + 400)
    det.processSample(suspiciousHit('book', 0.65), t0 + 800)
    const events = det.processSample(suspiciousHit('book', 0.7), t0 + SUSPICIOUS_THRESHOLD_MS)
    assert.equal(events.length, 1)
    assert.equal(events[0].event_type, 'suspicious_object')
    assert.equal(events[0].metadata.object_label, 'book')
  })

  it('no spam while persistent', () => {
    const det = new ObjectPresenceDetector(0)
    const t0 = GRACE_MS + 100
    det.processSample(suspiciousHit(), t0)
    det.processSample(suspiciousHit(), t0 + 400)
    det.processSample(suspiciousHit(), t0 + 800)
    const e1 = det.processSample(suspiciousHit(), t0 + SUSPICIOUS_THRESHOLD_MS)
    assert.equal(e1.length, 1)

    // Continue
    const e2 = det.processSample(suspiciousHit(), t0 + SUSPICIOUS_THRESHOLD_MS + 400)
    assert.equal(e2.length, 0)
  })

  it('absent >= REARM_MS → re-armed', () => {
    const det = new ObjectPresenceDetector(0)
    const t0 = GRACE_MS + 100
    det.processSample(suspiciousHit(), t0)
    det.processSample(suspiciousHit(), t0 + 400)
    det.processSample(suspiciousHit(), t0 + 800)
    det.processSample(suspiciousHit(), t0 + SUSPICIOUS_THRESHOLD_MS) // fires

    // Start recovery
    det.processSample(noDetection(), t0 + SUSPICIOUS_THRESHOLD_MS + 100)
    // End recovery after REARM_MS
    det.processSample(noDetection(), t0 + SUSPICIOUS_THRESHOLD_MS + 100 + REARM_MS + 100)

    // Episode 2
    const t2 = t0 + SUSPICIOUS_THRESHOLD_MS + 100 + REARM_MS + 200
    det.processSample(suspiciousHit(), t2)
    det.processSample(suspiciousHit(), t2 + 400)
    det.processSample(suspiciousHit(), t2 + 800)
    const e2 = det.processSample(suspiciousHit(), t2 + SUSPICIOUS_THRESHOLD_MS)
    assert.equal(e2.length, 1)
  })
})

// ---------------------------------------------------------------------------
// Startup grace tests
// ---------------------------------------------------------------------------

describe('ObjectPresenceDetector — Startup Grace', () => {
  it('no events during grace period', () => {
    const det = new ObjectPresenceDetector(0)
    // Multiple phone hits during grace
    det.processSample(phoneHit(0.8), 100)
    det.processSample(phoneHit(0.9), 500)
    const events = det.processSample(phoneHit(0.85), 1000)
    assert.equal(events.length, 0)
  })

  it('events possible after grace', () => {
    const det = new ObjectPresenceDetector(0)
    // During grace
    det.processSample(phoneHit(0.8), 100)
    // After grace
    const t0 = GRACE_MS + 100
    det.processSample(phoneHit(0.8), t0)
    const events = det.processSample(phoneHit(0.9), t0 + 300)
    assert.equal(events.length, 1)
  })
})

// ---------------------------------------------------------------------------
// Confidence handling
// ---------------------------------------------------------------------------

describe('ObjectPresenceDetector — Confidence', () => {
  it('emits highest confidence from window observations', () => {
    const det = new ObjectPresenceDetector(0)
    const t0 = GRACE_MS + 100
    det.processSample(phoneHit(0.5), t0)
    const events = det.processSample(phoneHit(0.85), t0 + 300)
    assert.equal(events.length, 1)
    assert.ok(events[0].confidence >= 0.85)
  })
})

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

describe('ObjectPresenceDetector — Reset', () => {
  it('reset clears all state and restarts grace', () => {
    const det = new ObjectPresenceDetector(0)
    const t0 = GRACE_MS + 100
    det.processSample(phoneHit(0.6), t0)
    det.processSample(phoneHit(0.7), t0 + 300) // fires

    // Reset
    det.reset(10000)

    // Should be in grace again
    const events = det.processSample(phoneHit(0.8), 10000 + 100)
    assert.equal(events.length, 0)
  })
})
