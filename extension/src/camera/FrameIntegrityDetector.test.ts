/**
 * FrameIntegrityDetector — pure-logic tests (Phase 8)
 *
 * Run with:
 *   node node_modules/tsx/dist/cli.mjs --test src/camera/FrameIntegrityDetector.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  FrameIntegrityDetector,
  classifyFrame,
  OBSCURED_THRESHOLD_MS,
  OBSCURED_RECOVERY_MS,
  FRAME_GRACE_MS,
  DARK_MEAN_THRESHOLD,
  BRIGHT_MEAN_THRESHOLD,
  UNIFORM_STDDEV_THRESHOLD,
  type FrameStatsInput,
} from './FrameIntegrityDetector'

// ---- helpers ----

const T0 = 10_000

const normalFrame: FrameStatsInput = {
  meanLuminance: 120,
  luminanceStddev: 40,
  darkPixelRatio: 0.02,
  brightPixelRatio: 0.01,
}

const darkUniform: FrameStatsInput = {
  meanLuminance: 8,
  luminanceStddev: 3,
  darkPixelRatio: 0.95,
  brightPixelRatio: 0,
}

const brightUniform: FrameStatsInput = {
  meanLuminance: 245,
  luminanceStddev: 4,
  darkPixelRatio: 0,
  brightPixelRatio: 0.90,
}

// ---------------------------------------------------------------------------

describe('classifyFrame', () => {
  it('normal frame — null', () => {
    assert.equal(classifyFrame(normalFrame), null)
  })

  it('dark uniform — dark_uniform', () => {
    assert.equal(classifyFrame(darkUniform), 'dark_uniform')
  })

  it('bright uniform — bright_uniform', () => {
    assert.equal(classifyFrame(brightUniform), 'bright_uniform')
  })

  it('extreme uniform — extreme_uniform', () => {
    const stats: FrameStatsInput = {
      meanLuminance: 100,
      luminanceStddev: 3,
      darkPixelRatio: 0,
      brightPixelRatio: 0,
    }
    assert.equal(classifyFrame(stats), 'extreme_uniform')
  })

  it('dark but high variance — null (not obscured)', () => {
    const stats: FrameStatsInput = {
      meanLuminance: 15,
      luminanceStddev: 30,
      darkPixelRatio: 0.5,
      brightPixelRatio: 0,
    }
    assert.equal(classifyFrame(stats), null)
  })
})

// ---------------------------------------------------------------------------

describe('FrameIntegrityDetector', () => {
  it('1. normal brightness/variance — no event', () => {
    const det = new FrameIntegrityDetector(T0)
    const t = T0 + FRAME_GRACE_MS + 100
    const events = det.processSample(normalFrame, t)
    assert.equal(events.length, 0)
  })

  it('2. one black frame — no event', () => {
    const det = new FrameIntegrityDetector(T0)
    const t = T0 + FRAME_GRACE_MS + 100
    const events = det.processSample(darkUniform, t)
    assert.equal(events.length, 0)
  })

  it('3. dark uniform persistent >= threshold — one camera_obscured', () => {
    const det = new FrameIntegrityDetector(T0)
    const base = T0 + FRAME_GRACE_MS + 100
    det.processSample(darkUniform, base)
    det.processSample(darkUniform, base + 500)
    const events = det.processSample(darkUniform, base + OBSCURED_THRESHOLD_MS)
    assert.equal(events.length, 1)
    assert.equal(events[0].event_type, 'camera_obscured')
    assert.equal(events[0].metadata.obstruction_type, 'dark_uniform')
    assert.equal(events[0].metadata.source, 'frame_integrity_analyzer')
  })

  it('4. remain obscured — no spam', () => {
    const det = new FrameIntegrityDetector(T0)
    const base = T0 + FRAME_GRACE_MS + 100
    det.processSample(darkUniform, base)
    det.processSample(darkUniform, base + OBSCURED_THRESHOLD_MS) // fires
    const e3 = det.processSample(darkUniform, base + OBSCURED_THRESHOLD_MS + 500)
    const e4 = det.processSample(darkUniform, base + OBSCURED_THRESHOLD_MS + 1000)
    assert.equal(e3.length, 0)
    assert.equal(e4.length, 0)
  })

  it('5. normal < recovery — not re-armed', () => {
    const det = new FrameIntegrityDetector(T0)
    const base = T0 + FRAME_GRACE_MS + 100
    det.processSample(darkUniform, base)
    det.processSample(darkUniform, base + OBSCURED_THRESHOLD_MS) // fires

    // One normal sample starts recovery
    det.processSample(normalFrame, base + OBSCURED_THRESHOLD_MS + 100)

    // Before recovery completes, dark again — cancels recovery
    const e = det.processSample(darkUniform, base + OBSCURED_THRESHOLD_MS + 500)
    assert.equal(e.length, 0) // no new event (already fired)
    assert.equal(det.isObscured(), true)
  })

  it('6. normal >= recovery — re-armed', () => {
    const det = new FrameIntegrityDetector(T0)
    const base = T0 + FRAME_GRACE_MS + 100
    det.processSample(darkUniform, base)
    det.processSample(darkUniform, base + OBSCURED_THRESHOLD_MS) // fires

    // Start recovery
    const recStart = base + OBSCURED_THRESHOLD_MS + 100
    det.processSample(normalFrame, recStart)
    // Complete recovery
    det.processSample(normalFrame, recStart + OBSCURED_RECOVERY_MS)

    assert.equal(det.isObscured(), false)

    // Second obstruction episode
    const ep2 = recStart + OBSCURED_RECOVERY_MS + 100
    det.processSample(darkUniform, ep2)
    const ev = det.processSample(darkUniform, ep2 + OBSCURED_THRESHOLD_MS)
    assert.equal(ev.length, 1)
    assert.equal(ev[0].event_type, 'camera_obscured')
  })

  it('7. second obstruction — second event', () => {
    const det = new FrameIntegrityDetector(T0)
    const base = T0 + FRAME_GRACE_MS + 100

    // Episode 1
    det.processSample(darkUniform, base)
    const ev1 = det.processSample(darkUniform, base + OBSCURED_THRESHOLD_MS)
    assert.equal(ev1.length, 1)

    // Recovery
    const recStart = base + OBSCURED_THRESHOLD_MS + 100
    det.processSample(normalFrame, recStart)
    det.processSample(normalFrame, recStart + OBSCURED_RECOVERY_MS)

    // Episode 2
    const ep2 = recStart + OBSCURED_RECOVERY_MS + 100
    det.processSample(darkUniform, ep2)
    const ev2 = det.processSample(darkUniform, ep2 + OBSCURED_THRESHOLD_MS)
    assert.equal(ev2.length, 1)
  })

  it('8. bright uniform obstruction — confirmed', () => {
    const det = new FrameIntegrityDetector(T0)
    const base = T0 + FRAME_GRACE_MS + 100
    det.processSample(brightUniform, base)
    const events = det.processSample(brightUniform, base + OBSCURED_THRESHOLD_MS)
    assert.equal(events.length, 1)
    assert.equal(events[0].metadata.obstruction_type, 'bright_uniform')
  })

  it('9. reset restarts grace', () => {
    const det = new FrameIntegrityDetector(T0)
    const base = T0 + FRAME_GRACE_MS + 100
    det.processSample(darkUniform, base)
    det.processSample(darkUniform, base + OBSCURED_THRESHOLD_MS) // fires

    const resetTime = base + 5000
    det.reset(resetTime)
    assert.equal(det.isObscured(), false)

    // During grace — no events
    const duringGrace = det.processSample(darkUniform, resetTime + 500)
    assert.equal(duringGrace.length, 0)

    // After grace
    const afterGrace = resetTime + FRAME_GRACE_MS + 100
    det.processSample(darkUniform, afterGrace)
    const ev = det.processSample(darkUniform, afterGrace + OBSCURED_THRESHOLD_MS)
    assert.equal(ev.length, 1)
  })

  it('10. during startup grace — no events', () => {
    const det = new FrameIntegrityDetector(T0)
    const e1 = det.processSample(darkUniform, T0 + 100)
    const e2 = det.processSample(darkUniform, T0 + 1000)
    assert.equal(e1.length, 0)
    assert.equal(e2.length, 0)
  })

  it('11. metadata includes rounded luminance stats', () => {
    const det = new FrameIntegrityDetector(T0)
    const base = T0 + FRAME_GRACE_MS + 100
    det.processSample(darkUniform, base)
    const events = det.processSample(darkUniform, base + OBSCURED_THRESHOLD_MS)
    assert.equal(events.length, 1)
    assert.equal(events[0].metadata.mean_luminance, Math.round(darkUniform.meanLuminance))
    assert.equal(events[0].metadata.luminance_stddev, Math.round(darkUniform.luminanceStddev))
  })
})
