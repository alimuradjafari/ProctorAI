/**
 * Screen review module — runs inside the offscreen document.
 *
 * Handles screen capture via navigator.mediaDevices.getDisplayMedia()
 * and WebRTC peer connection for live screen sharing.
 * Completely independent from the camera monitoring pipeline.
 *
 * Architecture (MV3):
 *   The offscreen document calls getDisplayMedia() directly — this is the
 *   Chrome-recommended pattern for MV3 extensions.  The service worker does
 *   NOT use chrome.desktopCapture (which requires targetTab in SW context).
 *
 * IMPORTANT: screenShareStream and cameraStream are separate MediaStreams.
 * Stopping one MUST NOT affect the other.
 */

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let screenShareStream: MediaStream | null = null
let peerConnection: RTCPeerConnection | null = null
let screenReviewId: string | null = null
let screenReviewActive = false

// ---------------------------------------------------------------------------
// Screen capture (getDisplayMedia — MV3 recommended pattern)
// ---------------------------------------------------------------------------

/**
 * Start screen sharing using navigator.mediaDevices.getDisplayMedia().
 *
 * This is the Chrome-recommended MV3 pattern: the offscreen document calls
 * getDisplayMedia() directly instead of the service worker using
 * chrome.desktopCapture.chooseDesktopMedia() (which requires targetTab in
 * SW context and is scoped to the target tab origin).
 *
 * The returned MediaStream is used directly in the offscreen document's
 * WebRTC peer connection — no streamId relay needed.
 *
 * Error differentiation:
 *   - NotAllowedError → student cancelled Chrome's native picker
 *     → sends SCREEN_REVIEW_CAPTURE_FAILED with reason 'picker_cancelled'
 *   - Other errors → technical failure
 *     → sends SCREEN_REVIEW_CAPTURE_FAILED with reason 'capture_failed'
 *
 * @param iceServers  ICE server configuration for RTCPeerConnection
 * @returns The SDP offer string to send to the instructor
 */
export async function startScreenCapture(
  iceServers: RTCIceServer[]
): Promise<string> {
  if (screenReviewActive) {
    throw new Error('Screen share already active')
  }

  // Call getDisplayMedia — Chrome's native picker appears here.
  // This must happen AFTER the student's explicit consent in the
  // ProctorAI overlay (the service worker gates this on ACCEPT).
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    })
  } catch (err) {
    // NotAllowedError = student cancelled Chrome's native picker
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      console.log('[ProctorAI ScreenReview] getDisplayMedia NotAllowedError — picker cancelled')
      sendCaptureFailed('picker_cancelled')
      throw err
    }
    // Any other error is a technical failure
    console.error('[ProctorAI ScreenReview] getDisplayMedia error:', err)
    sendCaptureFailed('capture_failed')
    throw err
  }

  // Validate the stream has a usable video track
  const videoTracks = stream.getVideoTracks()
  console.log('[ProctorAI] Display MediaStream created')
  console.log('[ProctorAI] screen tracks:', videoTracks.length)

  const videoTrack = videoTracks[0]
  if (!videoTrack) {
    console.error('[ProctorAI ScreenReview] No video track in display stream')
    sendCaptureFailed('capture_failed')
    throw new Error('No video track from getDisplayMedia')
  }

  console.log('[ProctorAI] track readyState:', videoTrack.readyState)
  screenShareStream = stream

  // Apply content hint for readable text
  const trackWithHint = videoTrack as MediaStreamTrack & { contentHint?: string }
  if ('contentHint' in trackWithHint) {
    trackWithHint.contentHint = 'detail'
  }

  // Listen for track end (student clicks Chrome's native "Stop sharing")
  videoTrack.onended = () => {
    console.log('[ProctorAI ScreenReview] Screen track ended by user')
    void stopScreenShare('track_ended')
  }

  screenReviewActive = true

  // Create WebRTC peer connection
  const pc = new RTCPeerConnection({
    iceServers: iceServers.length > 0 ? iceServers : undefined,
  })
  peerConnection = pc

  // Add screen video track(s) to peer connection
  for (const track of screenShareStream.getTracks()) {
    pc.addTrack(track, screenShareStream)
  }

  // Handle ICE candidates — send to service worker for relay
  pc.onicecandidate = (event) => {
    if (event.candidate && screenReviewId) {
      chrome.runtime.sendMessage({
        target: 'service-worker',
        type: 'SCREEN_REVIEW_ICE_CANDIDATE',
        screen_review_id: screenReviewId,
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      }).catch(() => {
        // Service worker may not be available — ignore
      })
    }
  }

  // Handle connection state changes
  pc.onconnectionstatechange = () => {
    console.log('[ProctorAI ScreenReview] PC state:', pc.connectionState)
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      void stopScreenShare('connection_failed')
    }
  }

  // Create SDP offer
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  const offerSdp = pc.localDescription?.sdp ?? offer.sdp ?? ''

  // Send offer to service worker for relay to instructor
  chrome.runtime.sendMessage({
    target: 'service-worker',
    type: 'SCREEN_REVIEW_OFFER',
    screen_review_id: screenReviewId,
    sdp: offerSdp,
  }).catch(() => {
    // Service worker may not be available yet
  })

  return offerSdp
}

/**
 * Notify the service worker that screen capture failed.
 * The service worker will relay this as screen_review_failed to the backend.
 */
function sendCaptureFailed(reason: string): void {
  chrome.runtime.sendMessage({
    target: 'service-worker',
    type: 'SCREEN_REVIEW_CAPTURE_FAILED',
    screen_review_id: screenReviewId,
    reason,
  }).catch(() => {
    // Service worker may not be available
  })
}

/**
 * Handle SDP answer from the instructor.
 */
export async function handleAnswer(sdp: string): Promise<void> {
  if (!peerConnection) {
    console.warn('[ProctorAI ScreenReview] No peer connection for answer')
    return
  }

  await peerConnection.setRemoteDescription(
    new RTCSessionDescription({ type: 'answer', sdp })
  )
}

/**
 * Handle ICE candidate from the instructor.
 */
export async function handleIceCandidate(
  candidate: string,
  sdpMid: string | null,
  sdpMLineIndex: number | null
): Promise<void> {
  if (!peerConnection) {
    console.warn('[ProctorAI ScreenReview] No peer connection for ICE')
    return
  }

  try {
    await peerConnection.addIceCandidate(
      new RTCIceCandidate({
        candidate,
        sdpMid: sdpMid ?? undefined,
        sdpMLineIndex: sdpMLineIndex ?? undefined,
      })
    )
  } catch (err) {
    console.warn('[ProctorAI ScreenReview] Failed to add ICE candidate:', err)
  }
}

/**
 * Stop screen sharing and clean up all resources.
 *
 * Idempotent — safe to call multiple times.
 * MUST NOT affect the camera monitoring pipeline.
 *
 * @param reason  Why sharing stopped (for logging)
 */
export async function stopScreenShare(reason?: string): Promise<void> {
  if (!screenReviewActive && !screenShareStream && !peerConnection) {
    return // Already cleaned up
  }

  console.log('[ProctorAI ScreenReview] Stopping screen share:', reason ?? 'manual')

  const reviewId = screenReviewId

  // Stop all screen tracks
  if (screenShareStream) {
    for (const track of screenShareStream.getTracks()) {
      track.onended = null // Prevent re-triggering
      track.stop()
    }
    screenShareStream = null
  }

  // Close peer connection
  if (peerConnection) {
    peerConnection.onicecandidate = null
    peerConnection.onconnectionstatechange = null
    peerConnection.close()
    peerConnection = null
  }

  screenReviewActive = false
  screenReviewId = null

  // Notify service worker
  if (reviewId) {
    chrome.runtime.sendMessage({
      target: 'service-worker',
      type: 'SCREEN_REVIEW_STOPPED',
      screen_review_id: reviewId,
      reason: reason ?? 'manual',
    }).catch(() => {
      // Service worker may not be available
    })
  }
}

/**
 * Set the current screen review ID (called when request arrives).
 */
export function setReviewId(id: string): void {
  screenReviewId = id
}

/**
 * Check if screen sharing is currently active.
 */
export function isActive(): boolean {
  return screenReviewActive
}
