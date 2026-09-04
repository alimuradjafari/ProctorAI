import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { MonitoringSession, WsConnectionState } from '../types/monitoring'

interface SessionHeaderProps {
  session: MonitoringSession
  wsState: WsConnectionState
  rosterCount: number
  error: string | null
}

const STATUS_BADGE: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  draft:     { bg: 'bg-gray-100',   text: 'text-gray-700',   dot: 'bg-gray-400',  label: 'DRAFT' },
  waiting:   { bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-400', label: 'WAITING' },
  live:      { bg: 'bg-green-100',  text: 'text-green-800',  dot: 'bg-green-500',  label: 'LIVE' },
  ended:     { bg: 'bg-gray-100',   text: 'text-gray-600',   dot: 'bg-gray-400',  label: 'ENDED' },
  cancelled: { bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500',    label: 'CANCELLED' },
}

const JOIN_MODE_LABELS: Record<string, string> = {
  open_join: 'Open Join',
  roster_required: 'Roster Required',
}

function getWsIndicator(state: WsConnectionState) {
  switch (state) {
    case 'connected':
      return { dot: 'bg-green-500', text: 'Live monitoring connected', className: 'text-green-700' }
    case 'connecting':
      return { dot: 'bg-yellow-500 animate-pulse', text: 'Connecting…', className: 'text-yellow-700' }
    case 'error':
      return { dot: 'bg-red-500', text: 'Connection error', className: 'text-red-600' }
    default:
      return { dot: 'bg-gray-400', text: 'Live updates temporarily unavailable. Reconnecting…', className: 'text-gray-500' }
  }
}

export function SessionHeader({ session, wsState, rosterCount, error }: SessionHeaderProps) {
  const [copied, setCopied] = useState(false)
  const badge = STATUS_BADGE[session.status] ?? STATUS_BADGE.draft
  const ws = getWsIndicator(wsState)

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(session.exam_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API may fail in non-secure contexts — ignore gracefully
    }
  }

  return (
    <>
      {/* Back link */}
      <div className="mb-4">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {/* Header Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 leading-tight">{session.title}</h1>
            {session.course_name && (
              <p className="text-sm text-gray-500 mt-1">{session.course_name}</p>
            )}
          </div>

          {/* Status badge */}
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold whitespace-nowrap ${badge.bg} ${badge.text}`}>
            <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
            {badge.label}
          </span>
        </div>

        {/* Exam Code + metadata row */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 mt-2">
          {/* Exam Code */}
          <div className="bg-primary-50 border border-primary-200 rounded-lg px-4 py-3 flex items-center gap-4">
            <div>
              <p className="text-xs text-primary-500 font-medium uppercase tracking-wide">Exam Code</p>
              <p className="text-2xl font-mono font-bold text-primary-800 tracking-widest mt-0.5">
                {session.exam_code}
              </p>
            </div>
            <button
              onClick={handleCopyCode}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary-300 text-primary-700 hover:bg-primary-100 text-xs font-medium transition-colors whitespace-nowrap"
              aria-label="Copy exam code to clipboard"
            >
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </>
              )}
            </button>
          </div>

          {/* Metadata */}
          <div className="flex gap-6 text-sm text-gray-600">
            <div>
              <span className="text-gray-400 text-xs">Join Mode</span>
              <p className="font-medium text-gray-700">{JOIN_MODE_LABELS[session.join_mode] ?? session.join_mode}</p>
            </div>
            <div>
              <span className="text-gray-400 text-xs">Roster</span>
              <p className="font-medium text-gray-700">{rosterCount} students</p>
            </div>
          </div>
        </div>

        {/* WebSocket connection indicator (shown only for live / waiting sessions) */}
        {(session.status === 'live' || session.status === 'waiting') && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ws.dot}`} />
            <span className={`text-xs ${ws.className}`}>{ws.text}</span>
          </div>
        )}

        {session.status === 'ended' && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <span className="text-xs text-gray-400">Session ended. Historical data is read-only.</span>
          </div>
        )}
      </div>
    </>
  )
}
