/**
 * BrowserSidePanelDetector — pure-logic tests (Phase 9.1)
 *
 * Run with:
 *   node node_modules/tsx/dist/cli.mjs --test src/browser/BrowserSidePanelDetector.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  BrowserSidePanelDetector,
  STARTUP_GRACE_MS,
  SIDE_PANEL_MIN_DELTA_PX,
  SIDE_PANEL_CONFIRM_MS,
  SIDE_PANEL_RECOVERY_MS,
  REBASELINE_STABLE_MS,
  type GeometrySample,
} from './BrowserSidePanelDetector'

// ---- helpers ----

const T0 = 10_000

// Normal browser window: ~30px of chrome between outer and inner width.
const normal: GeometrySample = {
  outerWidth: 1500,
  innerWidth: 1470,
  devicePixelRatio: 1,
}

// Side panel open: outerWidth unchanged, content width shrunk by 370px
// (delta 370 >= 220, shrink ratio 370/1470 ≈ 0.252 >= 0.15).
const panel: GeometrySample = {
  outerWidth: 1500,
  innerWidth: 1100,
  devicePixelRatio: 1,
}

/** Start a detector, capture the baseline, ready for post-grace samples. */
function armedDetector(): BrowserSidePanelDetector {
  const det = new BrowserSidePanelDetector(T0)
  det.processSample(normal, T0 + 100) // captures baseline
  return det
}

// ---------------------------------------------------------------------------

describe('BrowserSidePanelDetector', () => {
  it('1. normal stable viewport — no event', () => {
    const det = armedDetector()
    for (let t = 1600; t <= 5000; t += 250) {
      const events = det.processSample(normal, T0 + t)
      assert.equal(events.length, 0)
    }
  })

  it('2. small width fluctuation — no event', () => {
    const det = armedDetector()
    // 15px layout/scrollbar wobble — far below the side-panel threshold
    const wobble: GeometrySample = {
      outerWidth: 1500,
      innerWidth: normal.innerWidth - 15,
      devicePixelRatio: 1,
    }
    assert.ok(15 < SIDE_PANEL_MIN_DELTA_PX)
    for (let t = 1600; t <= 4000; t += 250) {
      const sample = t % 500 === 0 ? wobble : normal
      const events = det.processSample(sample, T0 + t)
      assert.equal(events.length, 0)
    }
  })

  it('3. single suspicious sample — no event', () => {
    const det = armedDetector()
    const events = det.processSample(panel, T0 + 1600)
    assert.equal(events.length, 0)
  })

  it('4. suspicious shrink < 500 ms — no event', () => {
    const det = armedDetector()
    det.processSample(panel, T0 + 1600) // candidate starts
    const e1 = det.processSample(normal, T0 + 1900) // 300 ms — back to normal
    assert.equal(e1.length, 0)
    // Candidate was reset — staying normal afterwards emits nothing
    const e2 = det.processSample(normal, T0 + 2500)
    assert.equal(e2.length, 0)
  })

  it('5. >=220px shrink, outer stable, persists >=500 ms — exactly one event', () => {
    const det = armedDetector()
    det.processSample(panel, T0 + 1600) // candidate starts
    const events = det.processSample(panel, T0 + 1600 + SIDE_PANEL_CONFIRM_MS)
    assert.equal(events.length, 1)

    const ev = events[0]
    assert.equal(ev.event_type, 'browser_side_panel')
    assert.equal(ev.metadata.source, 'viewport_geometry')
    assert.equal(ev.metadata.baseline_inner_width, 1470)
    assert.equal(ev.metadata.current_inner_width, 1100)
    assert.equal(ev.metadata.width_delta_px, 370)
    assert.equal(ev.metadata.shrink_ratio, 0.252) // 370/1470, 3 decimals
    assert.equal(ev.metadata.baseline_outer_width, 1500)
    assert.equal(ev.metadata.current_outer_width, 1500)
    assert.equal(ev.metadata.inset_delta_px, 370) // (1500-1100) - (1500-1470)
    assert.ok(ev.metadata.persistence_ms >= SIDE_PANEL_CONFIRM_MS)
    assert.ok(ev.client_event_id.length > 0)
    assert.ok(!Number.isNaN(Date.parse(ev.client_occurred_at)))
  })

  it('6. remain shrunk — no duplicate events', () => {
    const det = armedDetector()
    det.processSample(panel, T0 + 1600)
    const ev1 = det.processSample(panel, T0 + 2100)
    assert.equal(ev1.length, 1)
    for (let t = 2200; t <= 5000; t += 200) {
      const events = det.processSample(panel, T0 + t)
      assert.equal(events.length, 0)
    }
  })

  it('7. normal geometry < 1000 ms — not re-armed', () => {
    const det = armedDetector()
    det.processSample(panel, T0 + 1600)
    det.processSample(panel, T0 + 2100) // fires

    det.processSample(normal, T0 + 2200) // recovery starts
    // Panel re-opens only 400 ms into recovery — recovery cancels, no event
    const e1 = det.processSample(panel, T0 + 2600)
    assert.equal(e1.length, 0)
    // Even sustained suspicious geometry stays silent while fired
    const e2 = det.processSample(panel, T0 + 3100)
    const e3 = det.processSample(panel, T0 + 3600)
    assert.equal(e2.length, 0)
    assert.equal(e3.length, 0)
  })

  it('8. normal geometry >= 1000 ms — re-armed', () => {
    const det = armedDetector()
    det.processSample(panel, T0 + 1600)
    det.processSample(panel, T0 + 2100) // fires

    det.processSample(normal, T0 + 2200) // recovery starts
    const e1 = det.processSample(normal, T0 + 2200 + SIDE_PANEL_RECOVERY_MS)
    assert.equal(e1.length, 0) // recovery completion never emits

    // Re-armed: a fresh suspicious episode fires again
    det.processSample(panel, T0 + 3300)
    const e2 = det.processSample(panel, T0 + 3800)
    assert.equal(e2.length, 1)
  })

  it('9. second side-panel episode — second event', () => {
    const det = armedDetector()
    det.processSample(panel, T0 + 1600)
    const ev1 = det.processSample(panel, T0 + 2100)
    assert.equal(ev1.length, 1)

    // Recovery
    det.processSample(normal, T0 + 2200)
    det.processSample(normal, T0 + 3200)

    // Episode 2
    det.processSample(panel, T0 + 3300)
    const ev2 = det.processSample(panel, T0 + 3800)
    assert.equal(ev2.length, 1)
    assert.equal(ev2[0].event_type, 'browser_side_panel')
    assert.notEqual(ev2[0].client_event_id, ev1[0].client_event_id)
  })

  it('10. whole browser window resize — no browser_side_panel', () => {
    const det = armedDetector()
    // Window made narrower: outer AND inner change together
    const resized: GeometrySample = {
      outerWidth: 1200,
      innerWidth: 1170,
      devicePixelRatio: 1,
    }
    for (let t = 1600; t <= 4000; t += 250) {
      const events = det.processSample(resized, T0 + t)
      assert.equal(events.length, 0)
    }
  })

  it('11. after legitimate resize + stable period — new baseline established', () => {
    const det = armedDetector()
    const resized: GeometrySample = {
      outerWidth: 1200,
      innerWidth: 1170,
      devicePixelRatio: 1,
    }
    // Trigger the resize, then let geometry stay stable past REBASELINE_STABLE_MS
    det.processSample(resized, T0 + 1600)
    det.processSample(resized, T0 + 1850)
    det.processSample(resized, T0 + 2100)
    det.processSample(resized, T0 + 2350)
    det.processSample(resized, T0 + 2600)
    det.processSample(resized, T0 + 2850)
    // Stable from T0+1850 — adopted at T0+2600
    assert.ok(2600 - 1850 >= REBASELINE_STABLE_MS)

    // Side panel opens against the NEW baseline (outer 1200, inner 1170)
    const panelAfterResize: GeometrySample = {
      outerWidth: 1200,
      innerWidth: 800,
      devicePixelRatio: 1,
    }
    det.processSample(panelAfterResize, T0 + 2950)
    const events = det.processSample(panelAfterResize, T0 + 3450)
    assert.equal(events.length, 1)
    // Event reports the post-resize baseline, proving re-baselining worked
    assert.equal(events[0].metadata.baseline_outer_width, 1200)
    assert.equal(events[0].metadata.baseline_inner_width, 1170)
    assert.equal(events[0].metadata.width_delta_px, 370)
  })

  it('12. maximize/restore-like dimension changes — no false event', () => {
    const det = new BrowserSidePanelDetector(T0)
    const windowed: GeometrySample = {
      outerWidth: 1200,
      innerWidth: 1170,
      devicePixelRatio: 1,
    }
    const maximized: GeometrySample = {
      outerWidth: 1920,
      innerWidth: 1890,
      devicePixelRatio: 1,
    }
    det.processSample(windowed, T0 + 100) // baseline

    // Maximize
    for (let t = 1600; t <= 3500; t += 250) {
      assert.equal(det.processSample(maximized, T0 + t).length, 0)
    }
    // Restore
    for (let t = 3600; t <= 5500; t += 250) {
      assert.equal(det.processSample(windowed, T0 + t).length, 0)
    }
  })

  it('13. devicePixelRatio change — no false side-panel event', () => {
    const det = armedDetector()
    // Zoom change: DPR 1 → 1.25 also shrinks CSS innerWidth — must not fire
    const zoomed: GeometrySample = {
      outerWidth: 1500,
      innerWidth: 1100,
      devicePixelRatio: 1.25,
    }
    for (let t = 1600; t <= 4000; t += 250) {
      const events = det.processSample(zoomed, T0 + t)
      assert.equal(events.length, 0)
    }
  })

  it('14. startup grace — no event', () => {
    const det = new BrowserSidePanelDetector(T0)
    det.processSample(normal, T0 + 100) // baseline captured

    // Suspicious geometry entirely within the grace window
    const e1 = det.processSample(panel, T0 + 1200)
    const e2 = det.processSample(panel, T0 + 1400)
    assert.equal(e1.length, 0)
    assert.equal(e2.length, 0)
    assert.ok(1400 < STARTUP_GRACE_MS)

    // After grace the detector still works (no permanent suppression)
    det.processSample(panel, T0 + 1600)
    const e3 = det.processSample(panel, T0 + 2100)
    assert.equal(e3.length, 1)
  })

  it('15. reset — clears state and restarts grace', () => {
    const det = armedDetector()
    det.processSample(panel, T0 + 1600)
    const ev1 = det.processSample(panel, T0 + 2100)
    assert.equal(ev1.length, 1)

    const resetTime = T0 + 6000
    det.reset(resetTime)

    // New baseline captured from normal geometry; suspicious samples during
    // the new grace are ignored
    det.processSample(normal, resetTime + 500)
    const e1 = det.processSample(panel, resetTime + 1000)
    const e2 = det.processSample(panel, resetTime + 1400)
    assert.equal(e1.length, 0)
    assert.equal(e2.length, 0)

    // Past the new grace: fresh episode confirms normally
    det.processSample(panel, resetTime + 1600)
    const e3 = det.processSample(panel, resetTime + 2100)
    assert.equal(e3.length, 1)
    assert.notEqual(e3[0].client_event_id, ev1[0].client_event_id)
  })

  it('16. invalid zero/negative/degenerate dimensions — safely ignored', () => {
    const det = new BrowserSidePanelDetector(T0)
    const invalid: GeometrySample[] = [
      { outerWidth: 0, innerWidth: 0, devicePixelRatio: 1 },
      { outerWidth: -100, innerWidth: -200, devicePixelRatio: 1 },
      { outerWidth: 1000, innerWidth: 2000, devicePixelRatio: 1 }, // inner > outer
      { outerWidth: Number.NaN, innerWidth: 900, devicePixelRatio: 1 },
      { outerWidth: 1000, innerWidth: Number.NaN, devicePixelRatio: 1 },
      { outerWidth: 1000, innerWidth: 900, devicePixelRatio: 0 },
      { outerWidth: 1000, innerWidth: 900, devicePixelRatio: Number.NaN },
    ]
    for (const s of invalid) {
      assert.equal(det.processSample(s, T0 + 100).length, 0)
    }

    // Detector remains healthy: baseline from the next valid sample
    det.processSample(normal, T0 + 200)
    det.processSample(panel, T0 + 1600)
    const events = det.processSample(panel, T0 + 2100)
    assert.equal(events.length, 1)
  })
})
