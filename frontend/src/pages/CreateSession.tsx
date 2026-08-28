import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { createSession } from '../services/monitoring'
import type { JoinMode } from '../types/monitoring'

function CreateSession() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [courseName, setCourseName] = useState('')
  const [joinMode, setJoinMode] = useState<JoinMode>('open_join')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const session = await createSession({
        title: title.trim(),
        course_name: courseName.trim() || undefined,
        join_mode: joinMode,
      })
      navigate(`/sessions/${session.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
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

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Create Monitoring Session</h1>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
              Session Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., DSA Midterm Monitoring"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div>
            <label htmlFor="course" className="block text-sm font-medium text-gray-700 mb-1">
              Course Name
            </label>
            <input
              type="text"
              id="course"
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              placeholder="e.g., Data Structures & Algorithms"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Optional. Used to generate a meaningful exam code prefix.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Join Mode</label>
            <div className="space-y-2">
              <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="join_mode"
                  value="open_join"
                  checked={joinMode === 'open_join'}
                  onChange={() => setJoinMode('open_join')}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium text-gray-900">Open Join</p>
                  <p className="text-sm text-gray-500">
                    Any student with the exam code can join
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="join_mode"
                  value="roster_required"
                  checked={joinMode === 'roster_required'}
                  onChange={() => setJoinMode('roster_required')}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium text-gray-900">Roster Required</p>
                  <p className="text-sm text-gray-500">
                    Only students on the roster can join
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="flex-1 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {submitting ? 'Creating...' : 'Create Session'}
            </button>
            <Link
              to="/dashboard"
              className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateSession
