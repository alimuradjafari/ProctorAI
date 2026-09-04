/**
 * Strict TypeScript types for screen review signaling.
 *
 * These types define the WebSocket message payloads for the on-demand
 * live screen review feature (Phase 10.1).
 */

/** UI-level screen review status (frontend state machine). */
export type ScreenReviewStatus =
  | 'idle'
  | 'requesting'
  | 'requested'
  | 'accepted'
  | 'connecting'
  | 'active'
  | 'declined'
  | 'expired'
  | 'stopped'
  | 'error'
  | 'failed'
  | 'unreachable'

// ---------------------------------------------------------------------------
// Messages received from backend via instructor WebSocket
// ---------------------------------------------------------------------------

export interface ScreenReviewStatusPayload {
  type: 'screen_review_status'
  screen_review_id: string
  status: string
  participant_session_id: string
  message?: string
  student_name?: string
}

export interface ScreenReviewOfferPayload {
  type: 'screen_review_offer'
  screen_review_id: string
  sdp: string
}

export interface ScreenReviewIceCandidatePayload {
  type: 'screen_review_ice_candidate'
  screen_review_id: string
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
}

/** Union of all screen review WS messages from backend. */
export type ScreenReviewWsMessage =
  | ScreenReviewStatusPayload
  | ScreenReviewOfferPayload
  | ScreenReviewIceCandidatePayload

// ---------------------------------------------------------------------------
// Messages sent to backend via instructor WebSocket
// ---------------------------------------------------------------------------

export interface ScreenReviewRequestMessage {
  type: 'screen_review_request'
  participant_session_id: string
}

export interface ScreenReviewAnswerMessage {
  type: 'screen_review_answer'
  screen_review_id: string
  sdp: string
}

export interface ScreenReviewIceCandidateMessage {
  type: 'screen_review_ice_candidate'
  screen_review_id: string
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
}

export interface ScreenReviewStopMessage {
  type: 'screen_review_stop'
  screen_review_id: string
}

/** Union of all screen review messages the frontend sends. */
export type ScreenReviewOutgoingMessage =
  | ScreenReviewRequestMessage
  | ScreenReviewAnswerMessage
  | ScreenReviewIceCandidateMessage
  | ScreenReviewStopMessage
