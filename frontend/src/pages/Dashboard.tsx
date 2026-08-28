import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { listSessions } from '../services/monitoring'
import type { MonitoringSession } from '../types/monitoring'

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  waiting: 'bg-yellow-100 text-yellow-800',
  live: 'bg-green-100 text-green-800',
  ended: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-700',
}

const JOIN_MODE_LABELS: Record<string, string> = {
  open_join: 'Open Join',
  roster_required: 'Roster Required',
}

function Dashboard() {
  const { instructor } = useAuth()
  const [sessions, setSessions] = useState<MonitoringSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
          <p className="text-gray-500 text-sm">Loading sessions...</p>
        </div>
      ) : sessions.length === 0 ? (
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
      ) : (
        <div className="grid gap-4">
          {sessions.map((session) => (
            <Link
              key={session.id}
              to={`/sessions/${session.id}`}
              className="block bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900 truncate">
                      {session.title}
                    </h3>
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[session.status] || 'bg-gray-100 text-gray-700'}`}
                    >
                      {session.status.toUpperCase()}
                    </span>
                  </div>
                  {session.course_name && (
                    <p className="text-sm text-gray-600 mb-2">{session.course_name}</p>
                  )}
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span className="font-mono font-semibold text-primary-600">
                      {session.exam_code}
                    </span>
                    <span>{JOIN_MODE_LABELS[session.join_mode] || session.join_mode}</span>
                  </div>
                </div>
                <svg
                  className="w-5 h-5 text-gray-400 flex-shrink-0 ml-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default Dashboard
