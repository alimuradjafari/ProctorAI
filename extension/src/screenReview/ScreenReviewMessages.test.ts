/**
 * ScreenReviewMessages — pure-logic tests (Phase 11)
 *
 * Run with:
 *   node node_modules/tsx/dist/cli.mjs --test src/screenReview/ScreenReviewMessages.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseConsentMessage,
  parseOfferMessage,
  parseIceCandidateMessage,
  parseStoppedMessage,
  MAX_REVIEW_ID_LENGTH,
  MAX_SDP_LENGTH,
  MAX_CANDIDATE_LENGTH,
} from './ScreenReviewMessages'

const REVIEW_ID = 'SR-0123456789abcdef0123456789abcdef'

describe('ScreenReviewMessages', () => {
  // ---- parseConsentMessage ----

  it('1. valid consent parses; extra fields tolerated', () => {
    const msg = parseConsentMessage({
      target: 'service-worker',
      type: 'SCREEN_REVIEW_CONSENT',
      screen_review_id: REVIEW_ID,
      accepted: true,
    })
    assert.ok(msg !== null)
    assert.equal(msg.type, 'SCREEN_REVIEW_CONSENT')
    assert.equal(msg.screen_review_id, REVIEW_ID)
    assert.equal(msg.accepted, true)
  })

  it('2. valid declined consent parses', () => {
    const msg = parseConsentMessage({
      type: 'SCREEN_REVIEW_CONSENT',
      screen_review_id: REVIEW_ID,
      accepted: false,
    })
    assert.ok(msg !== null)
    assert.equal(msg.accepted, false)
  })

  it('3. consent rejects missing or empty review_id', () => {
    assert.equal(
      parseConsentMessage({ type: 'SCREEN_REVIEW_CONSENT', accepted: true }),
      null
    )
    assert.equal(
      parseConsentMessage({
        type: 'SCREEN_REVIEW_CONSENT',
        screen_review_id: '',
        accepted: true,
      }),
      null
    )
  })

  it('4. consent rejects non-boolean accepted', () => {
    const base = { type: 'SCREEN_REVIEW_CONSENT', screen_review_id: REVIEW_ID }
    assert.equal(parseConsentMessage({ ...base, accepted: 'yes' }), null)
    assert.equal(parseConsentMessage({ ...base, accepted: 1 }), null)
    assert.equal(parseConsentMessage(base), null)
  })

  it('5. consent rejects wrong type field value', () => {
    assert.equal(
      parseConsentMessage({
        type: 'SCREEN_REVIEW_OFFER',
        screen_review_id: REVIEW_ID,
        accepted: true,
      }),
      null
    )
    assert.equal(
      parseConsentMessage({
        type: 'show_screen_review_consent',
        screen_review_id: REVIEW_ID,
        accepted: true,
      }),
      null
    )
  })

  // ---- parseOfferMessage ----

  it('6. valid offer parses', () => {
    const msg = parseOfferMessage({
      target: 'service-worker',
      type: 'SCREEN_REVIEW_OFFER',
      screen_review_id: REVIEW_ID,
      sdp: 'v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\n',
    })
    assert.ok(msg !== null)
    assert.equal(msg.type, 'SCREEN_REVIEW_OFFER')
    assert.equal(msg.screen_review_id, REVIEW_ID)
    assert.ok(msg.sdp.length > 0)
  })

  it('7. offer rejects empty or missing sdp', () => {
    assert.equal(
      parseOfferMessage({
        type: 'SCREEN_REVIEW_OFFER',
        screen_review_id: REVIEW_ID,
        sdp: '',
      }),
      null
    )
    assert.equal(
      parseOfferMessage({ type: 'SCREEN_REVIEW_OFFER', screen_review_id: REVIEW_ID }),
      null
    )
  })

  it('8. offer rejects sdp over 10 KB; boundary length accepted', () => {
    const max = 'x'.repeat(MAX_SDP_LENGTH)
    assert.ok(
      parseOfferMessage({
        type: 'SCREEN_REVIEW_OFFER',
        screen_review_id: REVIEW_ID,
        sdp: max,
      }) !== null
    )
    assert.equal(
      parseOfferMessage({
        type: 'SCREEN_REVIEW_OFFER',
        screen_review_id: REVIEW_ID,
        sdp: max + 'x',
      }),
      null
    )
  })

  // ---- parseIceCandidateMessage ----

  it('9. valid ICE candidate parses with sdpMid string and sdpMLineIndex number', () => {
    const msg = parseIceCandidateMessage({
      target: 'service-worker',
      type: 'SCREEN_REVIEW_ICE_CANDIDATE',
      screen_review_id: REVIEW_ID,
      candidate: 'candidate:842163049 1 udp 1677729535 192.0.2.1 54400 typ srflx',
      sdpMid: '0',
      sdpMLineIndex: 0,
    })
    assert.ok(msg !== null)
    assert.equal(msg.sdpMid, '0')
    assert.equal(msg.sdpMLineIndex, 0)
  })

  it('10. ICE candidate with null sdpMid/sdpMLineIndex parses', () => {
    const msg = parseIceCandidateMessage({
      type: 'SCREEN_REVIEW_ICE_CANDIDATE',
      screen_review_id: REVIEW_ID,
      candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host',
      sdpMid: null,
      sdpMLineIndex: null,
    })
    assert.ok(msg !== null)
    assert.equal(msg.sdpMid, null)
    assert.equal(msg.sdpMLineIndex, null)
  })

  it('11. ICE candidate normalizes absent sdpMid/sdpMLineIndex to null', () => {
    const msg = parseIceCandidateMessage({
      type: 'SCREEN_REVIEW_ICE_CANDIDATE',
      screen_review_id: REVIEW_ID,
      candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host',
    })
    assert.ok(msg !== null)
    assert.equal(msg.sdpMid, null)
    assert.equal(msg.sdpMLineIndex, null)
  })

  it('12. ICE candidate rejects wrong sdpMid/sdpMLineIndex types', () => {
    const base = {
      type: 'SCREEN_REVIEW_ICE_CANDIDATE',
      screen_review_id: REVIEW_ID,
      candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host',
    }
    assert.equal(parseIceCandidateMessage({ ...base, sdpMid: 0 }), null)
    assert.equal(parseIceCandidateMessage({ ...base, sdpMLineIndex: '0' }), null)
    assert.equal(parseIceCandidateMessage({ ...base, sdpMLineIndex: true }), null)
  })

  it('13. ICE candidate rejects empty/oversized candidates; boundary accepted', () => {
    const base = { type: 'SCREEN_REVIEW_ICE_CANDIDATE', screen_review_id: REVIEW_ID }
    assert.equal(parseIceCandidateMessage({ ...base, candidate: '' }), null)
    const max = 'x'.repeat(MAX_CANDIDATE_LENGTH)
    assert.ok(parseIceCandidateMessage({ ...base, candidate: max }) !== null)
    assert.equal(parseIceCandidateMessage({ ...base, candidate: max + 'x' }), null)
  })

  // ---- parseStoppedMessage ----

  it('14. valid stopped messages parse for both stop sources', () => {
    const student = parseStoppedMessage({
      target: 'service-worker',
      type: 'SCREEN_REVIEW_STOP_FROM_STUDENT',
      screen_review_id: REVIEW_ID,
    })
    assert.ok(student !== null)
    assert.equal(student.type, 'SCREEN_REVIEW_STOP_FROM_STUDENT')
    assert.equal(student.screen_review_id, REVIEW_ID)

    const offscreen = parseStoppedMessage({
      target: 'service-worker',
      type: 'SCREEN_REVIEW_STOPPED',
      screen_review_id: REVIEW_ID,
      reason: 'track_ended',
    })
    assert.ok(offscreen !== null)
    assert.equal(offscreen.type, 'SCREEN_REVIEW_STOPPED')
  })

  it('15. stopped rejects missing review_id and wrong type', () => {
    assert.equal(parseStoppedMessage({ type: 'SCREEN_REVIEW_STOPPED' }), null)
    assert.equal(
      parseStoppedMessage({ type: 'SCREEN_REVIEW_STOPPED', screen_review_id: '' }),
      null
    )
    assert.equal(
      parseStoppedMessage({ type: 'STOPPED', screen_review_id: REVIEW_ID }),
      null
    )
  })

  // ---- shared review_id bounds + non-object inputs ----

  it('16. boundary-length review_id (64 chars) accepted by all parsers', () => {
    const boundary = 'a'.repeat(MAX_REVIEW_ID_LENGTH)
    assert.ok(
      parseConsentMessage({
        type: 'SCREEN_REVIEW_CONSENT',
        screen_review_id: boundary,
        accepted: false,
      }) !== null
    )
    assert.ok(
      parseOfferMessage({
        type: 'SCREEN_REVIEW_OFFER',
        screen_review_id: boundary,
        sdp: 'sdp',
      }) !== null
    )
    assert.ok(
      parseIceCandidateMessage({
        type: 'SCREEN_REVIEW_ICE_CANDIDATE',
        screen_review_id: boundary,
        candidate: 'c',
      }) !== null
    )
    assert.ok(
      parseStoppedMessage({
        type: 'SCREEN_REVIEW_STOPPED',
        screen_review_id: boundary,
      }) !== null
    )
  })

  it('17. over-limit review_id (65 chars) rejected by all parsers', () => {
    const oversized = 'a'.repeat(MAX_REVIEW_ID_LENGTH + 1)
    assert.equal(
      parseConsentMessage({
        type: 'SCREEN_REVIEW_CONSENT',
        screen_review_id: oversized,
        accepted: true,
      }),
      null
    )
    assert.equal(
      parseOfferMessage({
        type: 'SCREEN_REVIEW_OFFER',
        screen_review_id: oversized,
        sdp: 'sdp',
      }),
      null
    )
    assert.equal(
      parseIceCandidateMessage({
        type: 'SCREEN_REVIEW_ICE_CANDIDATE',
        screen_review_id: oversized,
        candidate: 'c',
      }),
      null
    )
    assert.equal(
      parseStoppedMessage({
        type: 'SCREEN_REVIEW_STOPPED',
        screen_review_id: oversized,
      }),
      null
    )
  })

  it('18. non-object inputs rejected by all parsers', () => {
    for (const raw of [null, undefined, 'string', 42, [], true]) {
      assert.equal(parseConsentMessage(raw), null)
      assert.equal(parseOfferMessage(raw), null)
      assert.equal(parseIceCandidateMessage(raw), null)
      assert.equal(parseStoppedMessage(raw), null)
    }
  })
})
