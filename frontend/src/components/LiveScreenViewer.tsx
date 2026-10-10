/**
 * Live screen viewer component.
 *
 * Displays the participant's screen via a <video> element with the
 * remote WebRTC MediaStream attached. Includes student info, status,
 * privacy note, and controls.
 *
 * No recording, screenshot, or download functionality is provided.
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import type { RiskLevel } from '../types/monitoring'
import { RiskBadge } from './RiskBadge'

interface LiveScreenViewerProps {
  stream: MediaStream | null
  studentName: string
  studentId: string
  riskScore: number
  riskLevel: RiskLevel
  onEndReview: () => void
}

export function LiveScreenViewer({
  stream,
  studentName,
  studentId,
  riskScore,
  riskLevel,
  onEndReview,
}: LiveScreenViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hasVideoFrame, setHasVideoFrame] = useState(false)

  // Attach stream to video element
  useEffect(() => {
    setHasVideoFrame(false)
    const video = videoRef.current
    if (!video || !stream) return

    video.srcObject = stream
    video.muted = true

    const startPlayback = () => {
      void video.play().catch((err) => {
        console.warn('[ScreenReview] Remote video playback did not start:', err)
      })
    }

    // A remote WebRTC track is often initially muted and becomes playable
    // only after the first RTP frame arrives. Retry at both browser signals.
    video.addEventListener('loadedmetadata', startPlayback)
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('unmute', startPlayback)
    }
    startPlayback()

    return () => {
      video.removeEventListener('loadedmetadata', startPlayback)
      for (const track of stream.getVideoTracks()) {
        track.removeEventListener('unmute', startPlayback)
      }
      video.pause()
      video.srcObject = null
    }
  }, [stream])

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    const container = viewerRef.current
    if (!container) return

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {})
      setIsFullscreen(true)
    } else {
      document.exitFullscreen().catch(() => {})
      setIsFullscreen(false)
    }
  }, [])

  // Listen for fullscreen change
  useEffect(() => {
    const handler = () => {
      setIsFullscreen(document.fullscreenElement === viewerRef.current)
    }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  return (
    <div ref={viewerRef} className="min-w-0 bg-gray-900 rounded-xl overflow-hidden">
      {/* Header bar */}
      <div className="flex flex-col gap-3 px-3 py-3 bg-gray-800 border-b border-gray-700">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
          {/* LIVE indicator */}
          <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
            <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">
              Live Screen
            </span>
          </div>

          {/* Student info */}
          <div className="min-w-0 break-words text-sm text-gray-200">
            <span className="font-medium">{studentName}</span>
            <span className="text-gray-400 ml-2">({studentId})</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <RiskBadge level={riskLevel} showBar score={riskScore} />

          {/* Fullscreen button */}
          <button
            onClick={toggleFullscreen}
            className="shrink-0 p-2 text-gray-400 hover:text-white rounded transition-colors"
            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            )}
          </button>

          {/* End review button */}
          <button
            onClick={onEndReview}
            className="shrink-0 whitespace-nowrap px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-md transition-colors"
          >
            End Live Review
          </button>
        </div>
      </div>

      {/* Video container */}
      <div className="relative bg-black" style={{ minHeight: '300px' }}>
        <video
          ref={videoRef}
          onLoadedData={() => setHasVideoFrame(true)}
          onPlaying={() => setHasVideoFrame(true)}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={(event) => {
            void event.currentTarget.play().catch(() => {})
          }}
          className="w-full h-auto object-contain"
          style={{ maxHeight: '600px' }}
        />

        {/* No stream placeholder */}
        {(!stream || !hasVideoFrame) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">Waiting for screen video…</p>
            </div>
          </div>
        )}
      </div>

      {/* Privacy note */}
      <div className="px-4 py-2 bg-gray-800 border-t border-gray-700">
        <p className="text-xs text-gray-400 text-center">
          Live view only — not recorded by ProctorAI.
        </p>
      </div>
    </div>
  )
}
