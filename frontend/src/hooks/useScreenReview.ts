/**
 * Custom hook for managing the WebRTC peer connection lifecycle
 * for on-demand live screen review.
 *
 * Uses the existing instructor WebSocket for signaling.
 * The instructor browser acts as the WebRTC answerer — the participant
 * (extension) creates the offer and sends it via the backend.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import type { MutableRefObject } from 'react'
import { API_BASE_URL } from '../lib/config'
import type {
  ScreenReviewStatus,
  ScreenReviewStatusPayload,
  ScreenReviewOfferPayload,
  ScreenReviewIceCandidatePayload,
} from '../types/screenReview'

interface UseScreenReviewReturn {
  /** Current status of the screen review. */
  status: ScreenReviewStatus
  /** Remote MediaStream from the participant's screen (null when not connected). */
  remoteStream: MediaStream | null
  /** Active screen review ID (null when idle). */
  activeReviewId: string | null
  /** Status message for display (e.g., "Waiting for student permission…"). */
  statusMessage: string
  /** Request a screen review for a participant. */
  startReview: (participantSessionId: string) => void
  /** End the current screen review. */
  endReview: () => void
  /** Handle an incoming WS message (call from SessionDetail's onmessage). */
  handleWsMessage: (data: Record<string, unknown>) => void
  /** Reset status to idle after an error/terminal state. */
  resetStatus: () => void
}

// ICE servers are fetched from the backend at runtime (/api/config/webrtc).
// This allows TURN credentials to be configured without redeploying the frontend.

/**
 * Map backend status strings to frontend ScreenReviewStatus.
 */
function mapBackendStatus(backendStatus: string): ScreenReviewStatus {
  switch (backendStatus) {
    case 'requested':
      return 'requested'
    case 'accepted':
      return 'accepted'
    case 'declined':
      return 'declined'
    case 'sharing':
      return 'active'
    case 'stopped':
      return 'stopped'
    case 'expired':
      return 'expired'
    case 'failed':
      return 'failed'
    case 'error':
      return 'error'
    default:
      return backendStatus as ScreenReviewStatus
  }
}

/**
 * Get a human-readable status message.
 */
function getStatusMessage(status: ScreenReviewStatus): string {
  switch (status) {
    case 'idle':
      return ''
    case 'requesting':
      return 'Requesting live screen…'
    case 'requested':
      return 'Waiting for student permission…'
    case 'accepted':
      return 'Student accepted — connecting…'
    case 'connecting':
      return 'Establishing connection…'
    case 'active':
      return 'Live screen connected'
    case 'declined':
      return 'Student declined the live screen request.'
    case 'expired':
      return 'Screen review request timed out.'
    case 'stopped':
      return 'Screen sharing stopped.'
    case 'error':
      return 'Screen review request failed.'
    case 'failed':
      return 'Screen review connection failed.'
    case 'unreachable':
      return 'Student is not connected.'
    default:
      return ''
  }
}

export function useScreenReview(
  wsRef: MutableRefObject<WebSocket | null>
): UseScreenReviewReturn {
  const [status, setStatus] = useState<ScreenReviewStatus>('idle')
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const statusRef = useRef<ScreenReviewStatus>('idle')
  const reviewIdRef = useRef<string | null>(null)
  const iceServersRef = useRef<RTCIceServer[]>([])

  // Fetch ICE servers from backend on mount (STUN/TURN config).
  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE_URL}/config/webrtc`)
      .then((res) => (res.ok ? res.json() : { ice_servers: [] }))
      .then((data) => {
        if (!cancelled && Array.isArray(data.ice_servers)) {
          iceServersRef.current = data.ice_servers
        }
      })
      .catch(() => {
        // Silently fall back to empty (local dev without backend).
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Keep refs in sync
  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    reviewIdRef.current = activeReviewId
  }, [activeReviewId])

  /**
   * Clean up the peer connection and streams.
   */
  const cleanupPc = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.onicecandidate = null
      pcRef.current.ontrack = null
      pcRef.current.onconnectionstatechange = null
      pcRef.current.close()
      pcRef.current = null
    }
    setRemoteStream(null)
  }, [])

  /**
   * Request a screen review for a participant.
   */
  const startReview = useCallback(
    (participantSessionId: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setStatus('error')
        return
      }

      setStatus('requesting')
      setActiveReviewId(null)

      wsRef.current.send(
        JSON.stringify({
          type: 'screen_review_request',
          participant_session_id: participantSessionId,
        })
      )
    },
    [wsRef]
  )

  /**
   * End the current screen review.
   */
  const endReview = useCallback(() => {
    const reviewId = reviewIdRef.current

    // Send stop message if we have an active review
    if (reviewId && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'screen_review_stop',
          screen_review_id: reviewId,
        })
      )
    }

    cleanupPc()
    setStatus('idle')
    setActiveReviewId(null)
  }, [wsRef, cleanupPc])

  /**
   * Handle an incoming WebSocket message related to screen review.
   */
  const handleWsMessage = useCallback(
    (data: Record<string, unknown>) => {
      const type = data.type as string

      // --- Status updates ---
      if (type === 'screen_review_status') {
        const payload = data as unknown as ScreenReviewStatusPayload
        const reviewId = payload.screen_review_id
        const mappedStatus = mapBackendStatus(payload.status)

        if (payload.status === 'requested') {
          setActiveReviewId(reviewId)
          setStatus('requested')
          return
        }

        // Only process if this is for our active review
        if (reviewId !== reviewIdRef.current && reviewIdRef.current !== null) {
          return
        }

        if (reviewId && !reviewIdRef.current) {
          setActiveReviewId(reviewId)
        }

        if (mappedStatus === 'accepted') {
          setStatus('connecting')
          // Create peer connection — we're the answerer
          createPeerConnection(reviewId)
          return
        }

        if (
          mappedStatus === 'declined' ||
          mappedStatus === 'expired' ||
          mappedStatus === 'stopped' ||
          mappedStatus === 'failed' ||
          mappedStatus === 'error'
        ) {
          cleanupPc()
          setStatus(mappedStatus)
          return
        }

        setStatus(mappedStatus)
        return
      }

      // --- SDP Offer from participant ---
      if (type === 'screen_review_offer') {
        const payload = data as unknown as ScreenReviewOfferPayload
        if (payload.screen_review_id !== reviewIdRef.current) return

        handleOffer(payload.sdp)
        return
      }

      // --- ICE Candidate from participant ---
      if (type === 'screen_review_ice_candidate') {
        const payload = data as unknown as ScreenReviewIceCandidatePayload
        if (payload.screen_review_id !== reviewIdRef.current) return

        handleIceCandidate(
          payload.candidate,
          payload.sdpMid,
          payload.sdpMLineIndex
        )
        return
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  /**
   * Create RTCPeerConnection (instructor is the answerer).
   */
  const createPeerConnection = useCallback(
    (reviewId: string) => {
      cleanupPc()

      const pc = new RTCPeerConnection({
        iceServers: iceServersRef.current.length > 0 ? iceServersRef.current : undefined,
      })
      pcRef.current = pc

      // Handle incoming screen video track
      pc.ontrack = (event) => {
        if (event.streams[0]) {
          setRemoteStream(event.streams[0])
          setStatus('active')
        }
      }

      // Relay ICE candidates to backend
      pc.onicecandidate = (event) => {
        if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'screen_review_ice_candidate',
              screen_review_id: reviewId,
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
            })
          )
        }
      }

      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          cleanupPc()
          setStatus('failed')
        } else if (pc.connectionState === 'disconnected') {
          // Momentary disconnect — don't immediately fail
          // The browser will attempt to reconnect
        }
      }
    },
    [wsRef, cleanupPc]
  )

  /**
   * Handle SDP offer from the participant — create answer and send it back.
   */
  const handleOffer = useCallback(
    async (sdp: string) => {
      const pc = pcRef.current
      const reviewId = reviewIdRef.current
      if (!pc || !reviewId) return

      try {
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: 'offer', sdp })
        )
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'screen_review_answer',
              screen_review_id: reviewId,
              sdp: pc.localDescription?.sdp ?? answer.sdp ?? '',
            })
          )
        }
      } catch (err) {
        console.error('[ScreenReview] Failed to handle offer:', err)
        cleanupPc()
        setStatus('failed')
      }
    },
    [wsRef, cleanupPc]
  )

  /**
   * Handle ICE candidate from the participant.
   */
  const handleIceCandidate = useCallback(
    async (
      candidate: string,
      sdpMid: string | null,
      sdpMLineIndex: number | null
    ) => {
      const pc = pcRef.current
      if (!pc) return

      try {
        await pc.addIceCandidate(
          new RTCIceCandidate({
            candidate,
            sdpMid: sdpMid ?? undefined,
            sdpMLineIndex: sdpMLineIndex ?? undefined,
          })
        )
      } catch (err) {
        console.warn('[ScreenReview] Failed to add ICE candidate:', err)
      }
    },
    []
  )

  const resetStatus = useCallback(() => {
    cleanupPc()
    setStatus('idle')
    setActiveReviewId(null)
  }, [cleanupPc])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
    }
  }, [])

  return {
    status,
    remoteStream,
    activeReviewId,
    statusMessage: getStatusMessage(status),
    startReview,
    endReview,
    handleWsMessage,
    resetStatus,
  }
}
