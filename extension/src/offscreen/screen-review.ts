/**
 * Screen review module — runs inside the offscreen document.
 *
 * Handles screen capture via chrome.desktopCapture and WebRTC peer
 * connection for live screen sharing. Completely independent from
 * the camera monitoring pipeline.
 *
 * IMPORTANT: screenShareStream and cameraStream are separate MediaStreams.
 * Stopping one MUST NOT affect the other.
 */

// ---------------------------------------------------------------------------
// Chromium-specific media constraint types (narrower than `any`)
// ---------------------------------------------------------------------------

/** Chromium-specific mandatory constraints for desktop capture. */
interface ChromiumDesktopConstraints {
  chromeMediaSource: 'desktop'
  chromeMediaSourceId: string
  maxWidth?: number
  maxHeight?: number
  maxFrameRate?: number
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let screenShareStream: MediaStream | null = null
let peerConnection: RTCPeerConnection | null = null
let screenReviewId: string | null = null
let screenReviewActive = false

// ---------------------------------------------------------------------------
// Screen capture
// ---------------------------------------------------------------------------

/**
 * Start screen sharing using a Chrome desktopCapture stream ID.
 *
 * Creates a MediaStream from the desktop source, applies content hint,
 * sets up a WebRTC peer connection, and generates an SDP offer.
 *
 * @param streamId  Temporary stream ID from chrome.desktopCapture
 * @param iceServers  ICE server configuration for RTCPeerConnection
 * @returns The SDP offer string to send to the instructor
 */
export async function startScreenShare(
  streamId: string,
  iceServers: RTCIceServer[]
): Promise<string> {
  if (screenReviewActive) {
    throw new Error('Screen share already active')
  }

  // Create screen MediaStream from desktop capture source
  const constraints: MediaStreamConstraints = {
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: streamId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 12,
      } as ChromiumDesktopConstraints,
    } as unknown as MediaTrackConstraints,
    audio: false,
  }

  screenShareStream = await navigator.mediaDevices.getUserMedia(constraints)

  // Apply content hint for readable text
  const videoTrack = screenShareStream.getVideoTracks()[0]
  if (videoTrack) {
    // contentHint improves encoding for static/screen content
    const track = videoTrack as MediaStreamTrack & { contentHint?: string }
    if ('contentHint' in track) {
      track.contentHint = 'detail'
    }

    // Listen for track end (student clicks Chrome "Stop sharing")
    videoTrack.onended = () => {
      console.log('[ProctorAI ScreenReview] Screen track ended by user')
      void stopScreenShare('track_ended')
    }
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
