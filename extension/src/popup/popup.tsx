import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { apiService } from '../services/api'
import type { ParticipantSession } from '../types'
import './popup.css'

const STORAGE_KEY = 'proctorai_session'

function Popup() {
  const [session, setSession] = useState<ParticipantSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form fields
  const [examCode, setExamCode] = useState('')
  const [studentId, setStudentId] = useState('')
  const [studentName, setStudentName] = useState('')

  useEffect(() => {
    restoreSession()
  }, [])

  async function restoreSession() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY)
      const stored = result[STORAGE_KEY] as ParticipantSession | undefined

      if (stored?.participant_access_token) {
        // Try to validate the stored token
        const me = await apiService.getParticipantMe(stored.participant_access_token)
        setSession({
          ...stored,
          student_id: me.student_id,
          student_name: me.student_name,
          exam_code: me.exam_code,
          title: me.title,
          course_name: me.course_name,
          session_status: me.session_status,
          status: me.status,
        })
      }
    } catch {
      // Token invalid, clear stale data
      await chrome.storage.local.remove(STORAGE_KEY)
    } finally {
      setLoading(false)
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    setJoining(true)
    setError(null)

    try {
      const response = await apiService.joinSession({
        exam_code: examCode.trim(),
        student_id: studentId.trim(),
        student_name: studentName.trim(),
      })

      const newSession: ParticipantSession = {
        participant_access_token: response.participant_access_token,
        participant_session_id: response.participant_session_id,
        student_id: response.participant.student_id,
        student_name: response.participant.student_name,
        exam_code: response.monitoring_session.exam_code,
        title: response.monitoring_session.title,
        course_name: response.monitoring_session.course_name,
        session_status: response.monitoring_session.status,
        status: response.participant.status,
      }

      await chrome.storage.local.set({ [STORAGE_KEY]: newSession })
      setSession(newSession)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join session')
    } finally {
      setJoining(false)
    }
  }

  async function handleDisconnect() {
    await chrome.storage.local.remove(STORAGE_KEY)
    setSession(null)
    setExamCode('')
    setStudentId('')
    setStudentName('')
  }

  if (loading) {
    return (
      <div className="popup-container">
        <div className="popup-header">
          <div className="logo">P</div>
          <h1>ProctorAI</h1>
        </div>
        <p className="loading-text">Loading...</p>
      </div>
    )
  }

  // Connected state
  if (session) {
    return (
      <div className="popup-container">
        <div className="popup-header">
          <div className="logo">P</div>
          <h1>ProctorAI</h1>
        </div>
        <p className="subtitle connected-subtitle">Connected to exam session</p>

        <div className="status-box connected-box">
          <span className="status-dot connected" />
          <span className="status-text">Joined — waiting for monitoring to begin.</span>
        </div>

        <div className="session-info">
          <div className="info-row">
            <span className="info-label">Exam</span>
            <span className="info-value mono">{session.exam_code}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Course</span>
            <span className="info-value">{session.course_name || session.title}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Student</span>
            <span className="info-value">{session.student_name}</span>
          </div>
          <div className="info-row">
            <span className="info-label">ID</span>
            <span className="info-value mono">{session.student_id}</span>
          </div>
        </div>

        <button className="disconnect-btn" onClick={handleDisconnect}>
          Disconnect
        </button>
      </div>
    )
  }

  // Join form state
  return (
    <div className="popup-container">
      <div className="popup-header">
        <div className="logo">P</div>
        <h1>ProctorAI</h1>
      </div>
      <p className="subtitle">Exam monitoring extension</p>

      {error && (
        <div className="error-box">
          <span className="error-text">{error}</span>
        </div>
      )}

      <form className="join-form" onSubmit={handleJoin}>
        <div className="form-group">
          <label htmlFor="exam-code">Exam ID</label>
          <input
            id="exam-code"
            type="text"
            placeholder="e.g., DSA-8K7P2"
            value={examCode}
            onChange={(e) => setExamCode(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="student-id">Student ID</label>
          <input
            id="student-id"
            type="text"
            placeholder="e.g., 2024-CS-001"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="student-name">Student Name</label>
          <input
            id="student-name"
            type="text"
            placeholder="e.g., Ali Khan"
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            required
          />
        </div>
        <button
          type="submit"
          className="join-btn"
          disabled={joining || !examCode.trim() || !studentId.trim() || !studentName.trim()}
        >
          {joining ? 'Joining...' : 'Join Monitoring Session'}
        </button>
      </form>
    </div>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<Popup />)
