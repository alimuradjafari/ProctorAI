import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { listSessions } from '../services/monitoring'
import type { MonitoringSession } from '../types/monitoring'

type ViewTab = 'active' | 'ended'

const STATUS_BADGE: Record<string, { bg: string; text: string; dot: string }> = {
  draft:     { bg: 'bg-gray-100',   text: 'text-gray-700',   dot: 'bg-gray-400' },
  waiting:   { bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-400' },
  live:      { bg: 'bg-green-100',  text: 'text-green-800',  dot: 'bg-green-500' },
  ended:     { bg: 'bg-gray-100',   text: 'text-gray-500',   dot: 'bg-gray-400' },
  cancelled: { bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500' },
}

const JOIN_MODE_LABELS: Record<string, string> = {
  open_join: 'Open Join',
  roster_required: 'Roster Required',
}

function isActive(s: MonitoringSession): boolean {
  return s.status === 'live' || s.status === 'waiting' || s.status === 'draft'
}

function Dashboard() {
  const { instructor } = useAuth()
  const [sessions, setSessions] = useState<MonitoringSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<ViewTab>('active')

  useEffect(() => {
    loadSessions()
  }, [])

  async function loadSessions() {
    try {
      const data = await listSessions()
      setSessions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }

  const activeSessions = useMemo(
    () => sessions.filter(isActive).sort((a, b) => {
      // LIVE first, then WAITING, then DRAFT; newest first within group
      const order: Record<string, number> = { live: 0, waiting: 1, draft: 2 }
      const diff = (order[a.status] ?? 9) - (order[b.status] ?? 9)
      if (diff !== 0) return diff
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    }),
    [sessions]
  )

  const endedSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.status === 'ended' || s.status === 'cancelled')
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [sessions]
  )

  // Auto-switch to ended tab if there are no active sessions but ended ones exist
  useEffect(() => {
    if (!loading && activeSessions.length === 0 && endedSessions.length > 0) {
      setTab('ended')
    }
  }, [loading, activeSessions.length, endedSessions.length])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          {instructor && (
            <p className="text-gray-500 text-sm mt-1">Welcome back, {instructor.full_name}</p>
          )}
        </div>
        <Link
          to="/sessions/create"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create Session
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="animate-pulse space-y-3 max-w-sm mx-auto">
            <div className="h-4 w-48 bg-gray-200 rounded mx-auto" />
            <div className="h-3 w-32 bg-gray-200 rounded mx-auto" />
          </div>
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Tab controls */}
          <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
            <button
              onClick={() => setTab('active')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === 'active'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Active
              <span className="ml-1.5 text-xs text-gray-400 tabular-nums">{activeSessions.length}</span>
            </button>
            <button
              onClick={() => setTab('ended')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === 'ended'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              History
              <span className="ml-1.5 text-xs text-gray-400 tabular-nums">{endedSessions.length}</span>
            </button>
          </div>

          {/* Active sessions */}
          {tab === 'active' && (
            activeSessions.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                No active sessions. Create a new session to get started.
              </p>
            ) : (
              <div className="grid gap-3">
                {activeSessions.map((session) => (
                  <SessionCard key={session.id} session={session} />
                ))}
              </div>
            )
          )}

          {/* Ended / cancelled sessions */}
          {tab === 'ended' && (
            endedSessions.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                No ended sessions yet.
              </p>
            ) : (
              <div className="grid gap-3">
                {endedSessions.map((session) => (
                  <SessionCard key={session.id} session={session} dimmed />
                ))}
              </div>
            )
          )}
        </>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────

function SessionCard({ session, dimmed }: { session: MonitoringSession; dimmed?: boolean }) {
  const badge = STATUS_BADGE[session.status] ?? STATUS_BADGE.draft

  return (
    <Link
      to={`/sessions/${session.id}`}
      className={`block rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow ${
        dimmed ? 'opacity-70 hover:opacity-100' : ''
      } bg-white`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1.5">
            <h3 className="text-base font-semibold text-gray-900 truncate">
              {session.title}
            </h3>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
              {session.status.toUpperCase()}
            </span>
          </div>
          {session.course_name && (
            <p className="text-sm text-gray-500 mb-1.5">{session.course_name}</p>
          )}
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span className="font-mono font-semibold text-primary-600">
              {session.exam_code}
            </span>
            <span>{JOIN_MODE_LABELS[session.join_mode] || session.join_mode}</span>
            <span>{new Date(session.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <svg
          className="w-5 h-5 text-gray-300 flex-shrink-0 ml-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  )
}

function EmptyState() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg
          className="w-8 h-8 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-gray-700 mb-1">No monitoring sessions yet</h2>
      <p className="text-gray-500 text-sm mb-4">
        Create your first monitoring session to get started.
      </p>
      <Link
        to="/sessions/create"
        className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
      >
        Create Your First Session
      </Link>
    </div>
  )
}

export default Dashboard
