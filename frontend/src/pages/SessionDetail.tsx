import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  getSession,
  listRoster,
  addRosterEntry,
  deleteRosterEntry,
  uploadRosterCsv,
  prepareSession,
  startSession,
  endSession,
  cancelSession,
  deleteSession,
  listParticipants,
} from '../services/monitoring'
import type { MonitoringSession, RosterEntry, RosterUploadResponse, Participant } from '../types/monitoring'

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

function SessionDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const sessionId = Number(id)

  const [session, setSession] = useState<MonitoringSession | null>(null)
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Roster form state
  const [newStudentId, setNewStudentId] = useState('')
  const [newStudentName, setNewStudentName] = useState('')
  const [addingStudent, setAddingStudent] = useState(false)

  // CSV upload state
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<RosterUploadResponse | null>(null)

  // Action state
  const [actionLoading, setActionLoading] = useState(false)

  // Participants state
  const [participants, setParticipants] = useState<Participant[]>([])
  const [refreshingParticipants, setRefreshingParticipants] = useState(false)

  useEffect(() => {
    loadSession()
    loadRoster()
    loadParticipants()
  }, [sessionId])

  async function loadSession() {
    try {
      const data = await getSession(sessionId)
      setSession(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session')
    } finally {
      setLoading(false)
    }
  }

  async function loadRoster() {
    try {
      const data = await listRoster(sessionId)
      setRoster(data)
    } catch {
      // Roster load failure is non-critical
    }
  }

  async function loadParticipants() {
    setRefreshingParticipants(true)
    try {
      const data = await listParticipants(sessionId)
      setParticipants(data)
    } catch {
      // Participants load failure is non-critical
    } finally {
      setRefreshingParticipants(false)
    }
  }

  async function handleLifecycleAction(action: 'prepare' | 'start' | 'end' | 'cancel') {
    setActionLoading(true)
    setError(null)
    try {
      const actions = { prepare: prepareSession, start: startSession, end: endSession, cancel: cancelSession }
      const updated = await actions[action](sessionId)
      setSession(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this session? This cannot be undone.')) return
    setActionLoading(true)
    try {
      await deleteSession(sessionId)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session')
      setActionLoading(false)
    }
  }

  async function handleAddStudent(e: React.FormEvent) {
    e.preventDefault()
    setAddingStudent(true)
    setError(null)
    try {
      await addRosterEntry(sessionId, newStudentId.trim(), newStudentName.trim())
      setNewStudentId('')
      setNewStudentName('')
      loadRoster()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add student')
    } finally {
      setAddingStudent(false)
    }
  }

  async function handleDeleteRosterEntry(entryId: number) {
    if (!confirm('Remove this student from the roster?')) return
    try {
      await deleteRosterEntry(sessionId, entryId)
      loadRoster()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove student')
    }
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadResult(null)
    setError(null)

    try {
      const result = await uploadRosterCsv(sessionId, file)
      setUploadResult(result)
      loadRoster()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV upload failed')
    } finally {
      setUploading(false)
      // Reset file input
      e.target.value = ''
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Loading session...</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Session not found</p>
        <Link to="/dashboard" className="text-primary-600 hover:underline mt-2 inline-block">
          Back to Dashboard
        </Link>
      </div>
    )
  }

  const canPrepare = session.status === 'draft'
  const canStart = session.status === 'waiting'
  const canEnd = session.status === 'live'
  const canCancel = session.status === 'draft' || session.status === 'waiting'
  const canDelete = session.status === 'draft' || session.status === 'cancelled'

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {/* Session Info Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{session.title}</h1>
            {session.course_name && (
              <p className="text-gray-600 mt-1">{session.course_name}</p>
            )}
          </div>
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[session.status]}`}
          >
            {session.status.toUpperCase()}
          </span>
        </div>

        {/* Exam Code - Large and prominent */}
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-primary-600 mb-1">Exam Code</p>
          <p className="text-3xl font-mono font-bold text-primary-800 tracking-wider">
            {session.exam_code}
          </p>
          <p className="text-xs text-primary-600 mt-2">
            Share this code with students to join the exam
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Join Mode:</span>
            <span className="ml-2 font-medium">{JOIN_MODE_LABELS[session.join_mode]}</span>
          </div>
          <div>
            <span className="text-gray-500">Roster:</span>
            <span className="ml-2 font-medium">{roster.length} students</span>
          </div>
        </div>

        {/* Lifecycle Actions */}
        <div className="flex flex-wrap gap-2 mt-6 pt-4 border-t border-gray-200">
          {canPrepare && (
            <button
              onClick={() => handleLifecycleAction('prepare')}
              disabled={actionLoading}
              className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50 text-sm font-medium"
            >
              Prepare (Set to Waiting)
            </button>
          )}
          {canStart && (
            <button
              onClick={() => handleLifecycleAction('start')}
              disabled={actionLoading}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
            >
              Start Session (Go Live)
            </button>
          )}
          {canEnd && (
            <button
              onClick={() => handleLifecycleAction('end')}
              disabled={actionLoading}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 text-sm font-medium"
            >
              End Session
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => handleLifecycleAction('cancel')}
              disabled={actionLoading}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 text-sm font-medium"
            >
              Cancel Session
            </button>
          )}
          {canDelete && (
            <button
              onClick={handleDelete}
              disabled={actionLoading}
              className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50 text-sm font-medium ml-auto"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Roster Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Student Roster</h2>

        {/* Add Student Form */}
        <form onSubmit={handleAddStudent} className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Student ID"
            value={newStudentId}
            onChange={(e) => setNewStudentId(e.target.value)}
            required
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          <input
            type="text"
            placeholder="Student Name"
            value={newStudentName}
            onChange={(e) => setNewStudentName(e.target.value)}
            required
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          <button
            type="submit"
            disabled={addingStudent || !newStudentId.trim() || !newStudentName.trim()}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium"
          >
            {addingStudent ? 'Adding...' : 'Add'}
          </button>
        </form>

        {/* CSV Upload */}
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200">
          <label className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm font-medium text-gray-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {uploading ? 'Uploading...' : 'Upload CSV'}
            <input
              type="file"
              accept=".csv"
              onChange={handleCsvUpload}
              className="hidden"
              disabled={uploading}
            />
          </label>
          <span className="text-xs text-gray-500">
            CSV format: student_id,name
          </span>
        </div>

        {/* Upload Result */}
        {uploadResult && (
          <div className={`rounded-lg p-4 mb-4 ${uploadResult.errors.length > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
            <p className="text-sm">
              <span className="font-medium">Added:</span> {uploadResult.added} |{' '}
              <span className="font-medium">Skipped:</span> {uploadResult.skipped}
            </p>
            {uploadResult.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-sm font-medium text-yellow-800">Errors:</p>
                <ul className="text-xs text-yellow-700 mt-1 space-y-1">
                  {uploadResult.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Roster Table */}
        {roster.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">
            No students in the roster yet
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Student ID</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Name</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((entry) => (
                  <tr key={entry.id} className="border-b border-gray-100">
                    <td className="py-2 px-3 font-mono text-gray-900">{entry.student_id}</td>
                    <td className="py-2 px-3 text-gray-700">{entry.student_name}</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => handleDeleteRosterEntry(entry.id)}
                        className="text-red-600 hover:text-red-800 text-xs font-medium"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Participants Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Participants
            <span className="ml-2 text-sm font-normal text-gray-500">
              ({participants.length} joined)
            </span>
          </h2>
          <button
            onClick={loadParticipants}
            disabled={refreshingParticipants}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <svg
              className={`w-4 h-4 ${refreshingParticipants ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
        </div>

        {participants.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">
            No participants have joined yet
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Student ID</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Name</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Status</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Joined</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p) => (
                  <tr key={p.participant_session_id} className="border-b border-gray-100">
                    <td className="py-2 px-3 font-mono text-gray-900">{p.student_id}</td>
                    <td className="py-2 px-3 text-gray-700">{p.student_name}</td>
                    <td className="py-2 px-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        {p.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-500 text-xs">
                      {new Date(p.joined_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default SessionDetail
