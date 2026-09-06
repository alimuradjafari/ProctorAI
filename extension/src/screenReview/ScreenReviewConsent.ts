/**
 * ProctorAI — Screen Review Consent Decision Logic
 *
 * Pure module that resolves the result of a screen-review consent + capture
 * flow into the correct WebSocket message type.  Extracted from the
 * service worker so it can be unit-tested without Chrome APIs.
 *
 * State machine:
 *   REQUESTED → (student clicks Share)  → send `screen_review_accepted`
 *               → (chooseDesktopMedia)
 *                 → valid streamId      → proceed (no WS status message)
 *                 → empty streamId      → send `screen_review_failed`  reason=picker_cancelled
 *                 → API/runtime error   → send `screen_review_failed`  reason=capture_failed
 *   REQUESTED → (student clicks Decline) → send `screen_review_declined` reason=explicit_decline
 *
 * CRITICAL: `screen_review_declined` is ONLY sent for an actual user decline.
 * Technical errors and picker cancellations use `screen_review_failed`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScreenReviewOutcome =
  | 'explicit_decline'
  | 'picker_cancelled'
  | 'capture_failed'

export interface ScreenReviewResultMessage {
  type: 'screen_review_declined' | 'screen_review_failed'
  screen_review_id: string
  reason: string
}

// ---------------------------------------------------------------------------
// Decision function
// ---------------------------------------------------------------------------

/**
 * Resolve the correct WS message for a screen-review terminal outcome.
 *
 * @param reviewId  — active screen-review identifier
 * @param outcome   — what happened after the student's decision
 *
 * Returns:
 *   - `screen_review_declined`  for EXPLICIT_DECLINE (student clicked Decline)
 *   - `screen_review_failed`    for PICKER_CANCELLED or START_FAILED
 */
export function resolveScreenReviewResult(
  reviewId: string,
  outcome: ScreenReviewOutcome,
): ScreenReviewResultMessage {
  if (outcome === 'explicit_decline') {
    return {
      type: 'screen_review_declined',
      screen_review_id: reviewId,
      reason: 'explicit_decline',
    }
  }

  return {
    type: 'screen_review_failed',
    screen_review_id: reviewId,
    reason: outcome,
  }
}
