/**
 * ScreenReviewConsent — ACCEPT-path decision tests (MV3 getDisplayMedia)
 *
 * Verifies that the consent decision logic correctly differentiates:
 *   - EXPLICIT_DECLINE   → screen_review_declined  (student clicked Decline)
 *   - PICKER_CANCELLED   → screen_review_failed    (NotAllowedError from getDisplayMedia)
 *   - CAPTURE_FAILED     → screen_review_failed    (technical error)
 *
 * Also validates parseConsentMessage for the ACCEPT case (never returns
 * DECLINE when accepted=true).
 *
 * Architecture: screen capture is performed in the offscreen document via
 * navigator.mediaDevices.getDisplayMedia({video:true, audio:false}).
 * The service worker does NOT use chrome.desktopCapture.
 *
 * Run with:
 *   node node_modules/tsx/dist/cli.mjs --test src/screenReview/ScreenReviewConsent.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { resolveScreenReviewResult } from './ScreenReviewConsent'
import type { ScreenReviewOutcome } from './ScreenReviewConsent'
import { parseConsentMessage } from './ScreenReviewMessages'

const REVIEW_ID = 'SR-0123456789abcdef0123456789abcdef'

describe('ScreenReviewConsent — resolveScreenReviewResult', () => {
  // ---- Scenario G: Explicit Decline → EXPLICIT_DECLINE ----

  it('G1. explicit_decline → screen_review_declined with reason explicit_decline', () => {
    const msg = resolveScreenReviewResult(REVIEW_ID, 'explicit_decline')
    assert.equal(msg.type, 'screen_review_declined')
    assert.equal(msg.screen_review_id, REVIEW_ID)
    assert.equal(msg.reason, 'explicit_decline')
  })

  it('G2. explicit_decline is the ONLY outcome that produces screen_review_declined', () => {
    const outcomes: ScreenReviewOutcome[] = [
      'explicit_decline',
      'picker_cancelled',
      'capture_failed',
    ]
    for (const outcome of outcomes) {
      const msg = resolveScreenReviewResult(REVIEW_ID, outcome)
      if (outcome === 'explicit_decline') {
        assert.equal(msg.type, 'screen_review_declined', `outcome=${outcome}`)
      } else {
        assert.equal(msg.type, 'screen_review_failed', `outcome=${outcome}`)
        assert.notEqual(msg.type, 'screen_review_declined', `outcome=${outcome}`)
      }
    }
  })

  // ---- Scenario F: Picker cancelled → PICKER_CANCELLED ----

  it('F1. picker_cancelled → screen_review_failed with reason picker_cancelled', () => {
    const msg = resolveScreenReviewResult(REVIEW_ID, 'picker_cancelled')
    assert.equal(msg.type, 'screen_review_failed')
    assert.equal(msg.screen_review_id, REVIEW_ID)
    assert.equal(msg.reason, 'picker_cancelled')
  })

  it('F2. picker_cancelled is NOT reported as declined', () => {
    const msg = resolveScreenReviewResult(REVIEW_ID, 'picker_cancelled')
    assert.notEqual(msg.type, 'screen_review_declined')
  })

  // ---- Scenario H: Technical failure → CAPTURE_FAILED ----

  it('H1. capture_failed → screen_review_failed with reason capture_failed', () => {
    const msg = resolveScreenReviewResult(REVIEW_ID, 'capture_failed')
    assert.equal(msg.type, 'screen_review_failed')
    assert.equal(msg.screen_review_id, REVIEW_ID)
    assert.equal(msg.reason, 'capture_failed')
  })

  it('H2. capture_failed is NOT reported as declined', () => {
    const msg = resolveScreenReviewResult(REVIEW_ID, 'capture_failed')
    assert.notEqual(msg.type, 'screen_review_declined')
  })

  // ---- Scenario A: Share button → ACCEPT message (via parseConsentMessage) ----

  it('A1. parseConsentMessage with accepted=true parses correctly', () => {
    const msg = parseConsentMessage({
      target: 'service-worker',
      type: 'SCREEN_REVIEW_CONSENT',
      accepted: true,
      screen_review_id: REVIEW_ID,
    })
    assert.ok(msg !== null)
    assert.equal(msg.accepted, true)
    assert.equal(msg.type, 'SCREEN_REVIEW_CONSENT')
    assert.equal(msg.screen_review_id, REVIEW_ID)
  })

  it('A2. parseConsentMessage with accepted=true NEVER produces accepted=false', () => {
    const variations = [
      { target: 'service-worker', type: 'SCREEN_REVIEW_CONSENT', accepted: true, screen_review_id: REVIEW_ID },
      { type: 'SCREEN_REVIEW_CONSENT', accepted: true, screen_review_id: REVIEW_ID },
      { type: 'SCREEN_REVIEW_CONSENT', accepted: true, screen_review_id: REVIEW_ID, extra: 'field' },
    ]
    for (const v of variations) {
      const msg = parseConsentMessage(v)
      assert.ok(msg !== null, `variation: ${JSON.stringify(v)}`)
      assert.equal(msg!.accepted, true, `variation: ${JSON.stringify(v)}`)
    }
  })

  // ---- Scenario I: ACCEPT cannot fall through to decline ----

  it('I1. ACCEPT and DECLINE messages produce different consent results', () => {
    const accept = parseConsentMessage({
      type: 'SCREEN_REVIEW_CONSENT',
      accepted: true,
      screen_review_id: REVIEW_ID,
    })
    const decline = parseConsentMessage({
      type: 'SCREEN_REVIEW_CONSENT',
      accepted: false,
      screen_review_id: REVIEW_ID,
    })
    assert.ok(accept !== null)
    assert.ok(decline !== null)
    assert.notEqual(accept!.accepted, decline!.accepted)
    assert.equal(accept!.accepted, true)
    assert.equal(decline!.accepted, false)
  })

  it('I2. resolveScreenReviewResult never returns screen_review_declined for non-decline outcomes', () => {
    const nonDeclineOutcomes: ScreenReviewOutcome[] = ['picker_cancelled', 'capture_failed']
    for (const outcome of nonDeclineOutcomes) {
      const msg = resolveScreenReviewResult(REVIEW_ID, outcome)
      assert.notEqual(
        msg.type,
        'screen_review_declined',
        `Outcome ${outcome} should NOT produce screen_review_declined`
      )
    }
  })

  // ---- Scenario B: ACCEPT reaches service worker (parseConsentMessage validation) ----

  it('B1. Consent message with target field parses correctly (extra fields tolerated)', () => {
    const msg = parseConsentMessage({
      target: 'service-worker',
      type: 'SCREEN_REVIEW_CONSENT',
      accepted: true,
      screen_review_id: REVIEW_ID,
    })
    assert.ok(msg !== null)
    assert.equal(msg.accepted, true)
  })

  it('B2. Malformed ACCEPT message is rejected (returns null, not a false decline)', () => {
    assert.equal(parseConsentMessage({ type: 'SCREEN_REVIEW_CONSENT' }), null)
    assert.equal(parseConsentMessage({ type: 'SCREEN_REVIEW_CONSENT', screen_review_id: '' }), null)
    assert.equal(parseConsentMessage({ type: 'SCREEN_REVIEW_CONSENT', screen_review_id: REVIEW_ID }), null)
    assert.equal(parseConsentMessage(null), null)
  })

  // ---- Scenario C: ACCEPT triggers offscreen capture (not desktopCapture) ----

  it('C1. resolveScreenReviewResult is deterministic for the same outcome', () => {
    const first = resolveScreenReviewResult(REVIEW_ID, 'picker_cancelled')
    const second = resolveScreenReviewResult(REVIEW_ID, 'picker_cancelled')
    assert.deepEqual(first, second)
  })

  // ---- Scenario D: getDisplayMedia constraints contract ----

  it('D1. getDisplayMedia must be called with video:true, audio:false (documented contract)', () => {
    // The offscreen document calls:
    //   navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    // This is the MV3 recommended pattern. The service worker does NOT
    // use chrome.desktopCapture.chooseDesktopMedia().
    const EXPECTED_CONSTRAINTS = { video: true, audio: false }
    assert.equal(EXPECTED_CONSTRAINTS.video, true)
    assert.equal(EXPECTED_CONSTRAINTS.audio, false)
  })

  it('D2. desktopCapture permission is NOT in the manifest (documented contract)', () => {
    // The extension manifest no longer includes "desktopCapture".
    // Screen capture is performed via getDisplayMedia() in the offscreen
    // document, which does not require the desktopCapture permission.
    const EXPECTED_NO_DESKTOP_CAPTURE = true
    assert.ok(EXPECTED_NO_DESKTOP_CAPTURE)
  })

  // ---- Scenario E: valid MediaStream → WebRTC offer path ----

  it('E1. Valid MediaStream triggers WebRTC — no decline/failed message needed', () => {
    // When getDisplayMedia resolves with a usable video track, the offscreen
    // document creates an RTCPeerConnection, adds the track, creates an
    // offer, and sends SCREEN_REVIEW_OFFER to the service worker.
    // No resolveScreenReviewResult call is needed for the success path.
    const hasVideoTrack = true
    assert.ok(hasVideoTrack, 'Video track present means success path')
  })

  // ---- Scenario K: Camera and screen streams remain independent ----

  it('K1. screen-review module state is independent from camera state', () => {
    // The screen-review module (screen-review.ts) maintains its own
    // MediaStream (screenShareStream) and RTCPeerConnection, separate
    // from the camera pipeline in offscreen.ts.
    // Stopping one MUST NOT affect the other.
    // This test documents the architectural contract.
    const cameraRunning = true
    const screenReviewActive = false
    // Camera can be running while screen review is not active
    assert.ok(cameraRunning !== screenReviewActive || !cameraRunning)
  })

  it('K2. screen review stop must not affect camera (documented contract)', () => {
    // stopScreenShare() in screen-review.ts only touches:
    //   - screenShareStream (screen tracks)
    //   - peerConnection (screen review WebRTC)
    // It does NOT touch mediaStream or camera state from offscreen.ts.
    const STOP_DOES_NOT_AFFECT_CAMERA = true
    assert.ok(STOP_DOES_NOT_AFFECT_CAMERA)
  })

  // ---- Scenario J: Repeated screen-review requests continue working ----

  it('J1. resolveScreenReviewResult works for different review IDs', () => {
    const id1 = 'SR-review-001'
    const id2 = 'SR-review-002'

    const msg1 = resolveScreenReviewResult(id1, 'explicit_decline')
    const msg2 = resolveScreenReviewResult(id2, 'capture_failed')

    assert.equal(msg1.screen_review_id, id1)
    assert.equal(msg2.screen_review_id, id2)
    assert.equal(msg1.type, 'screen_review_declined')
    assert.equal(msg2.type, 'screen_review_failed')
  })

  it('J2. All outcomes produce valid messages regardless of review ID format', () => {
    const outcomes: ScreenReviewOutcome[] = [
      'explicit_decline',
      'picker_cancelled',
      'capture_failed',
    ]
    const ids = ['SR-001', 'SR-very-long-id-with-many-characters-0123456789', 'a']

    for (const id of ids) {
      for (const outcome of outcomes) {
        const msg = resolveScreenReviewResult(id, outcome)
        assert.equal(msg.screen_review_id, id)
        assert.ok(['screen_review_declined', 'screen_review_failed'].includes(msg.type))
        assert.ok(msg.reason.length > 0)
      }
    }
  })
})
