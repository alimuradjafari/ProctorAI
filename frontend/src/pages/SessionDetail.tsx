import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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
  listEvents,
  getSessionRisk,
  WS_BASE_URL,
} from '../services/monitoring'
import type {
  MonitoringSession,
  RosterEntry,
  RosterUploadResponse,
  Participant,
  MonitoringEvent,
  WsConnectionState,
  ParticipantRiskSnapshot,
  ParticipantRiskWsPayload,
  EventType,
  Severity,
} from '../types/monitoring'

// Extracted components
import ErrorBoundary from '../components/ErrorBoundary'
import { SessionHeader } from '../components/SessionHeader'
import { SessionSummaryCards } from '../components/SessionSummaryCards'
import { LifecycleActions } from '../components/LifecycleActions'
import { RosterSection } from '../components/RosterSection'
import { RiskTable } from '../components/RiskTable'
import { ParticipantReviewModal } from '../components/ParticipantReviewModal'
import { LiveEventFeed } from '../components/LiveEventFeed'
import { useScreenReview } from '../hooks/useScreenReview'

function SessionDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const sessionId = Number(id)

  const [session, setSession] = useState<MonitoringSession | null>(null)
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // CSV upload state
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<RosterUploadResponse | null>(null)
  const [addingStudent, setAddingStudent] = useState(false)

  // Action state
  const [actionLoading, setActionLoading] = useState(false)

  // Participants state
  const [_participants, setParticipants] = useState<Participant[]>([])

  // Monitoring Events state
  const [events, setEvents] = useState<MonitoringEvent[]>([])
  const [wsState, setWsState] = useState<WsConnectionState>('disconnected')
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Risk state
  const [riskSnapshots, setRiskSnapshots] = useState<ParticipantRiskSnapshot[]>([])
  const riskSnapshotsRef = useRef<ParticipantRiskSnapshot[]>([])

  // Participant review modal
  const [reviewTarget, setReviewTarget] = useState<ParticipantRiskSnapshot | null>(null)

  // Screen review (Phase 10.1)
  const {
    status: srStatus,
    remoteStream: srStream,
    statusMessage: srMessage,
    startReview: startScreenReview,
    endReview: endScreenReview,
    handleWsMessage: handleSrWsMessage,
    resetStatus: resetSrStatus,
  } = useScreenReview(wsRef)

  useEffect(() => {
    loadSession()
    loadRoster()
    loadParticipants()
    loadEvents()
    loadRisk()
  }, [sessionId])

  // Keep risk snapshots ref in sync for ws.onmessage access
  useEffect(() => {
    riskSnapshotsRef.current = riskSnapshots
  }, [riskSnapshots])

  // WebSocket connection effect
  useEffect(() => {
    if (session?.status !== 'live') return

    connectWebSocket()

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [session?.status, sessionId])

  // ── Data loaders ──────────────────────────────────────────────

  function connectWebSocket() {
    const token = localStorage.getItem('access_token')
    if (!token) return

    setWsState('connecting')
    const ws = new WebSocket(`${WS_BASE_URL}/ws/monitoring-sessions/${sessionId}`)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'authenticate', access_token: token }))
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'authenticated') {
          setWsState('connected')
        } else if (data.type === 'monitoring_event') {
          const newEvent = enrichMonitoringEvent(
            data.event as Record<string, unknown>,
            riskSnapshotsRef.current
          )
          setEvents((prev) => {
            if (prev.some((e) => e.event_id === newEvent.event_id)) return prev
            return [newEvent, ...prev].slice(0, 200)
          })
        } else if (data.type === 'participant_risk_updated') {
          const update = data as ParticipantRiskWsPayload
          setRiskSnapshots((prev) => {
            const idx = prev.findIndex(
              (s) => s.participant_session_id === update.participant_session_id
            )
            if (idx >= 0) {
              const updated = [...prev]
              updated[idx] = {
                ...updated[idx],
                risk_score: update.risk_score,
                risk_level: update.risk_level,
                total_events: update.total_events,
              }
              return updated.sort(
                (a, b) => b.risk_score - a.risk_score || a.student_name.localeCompare(b.student_name)
              )
            }
            return prev
          })
        } else if (
          data.type === 'screen_review_status' ||
          data.type === 'screen_review_offer' ||
          data.type === 'screen_review_ice_candidate'
        ) {
          // Phase 10.1: Route screen review signaling to hook
          handleSrWsMessage(data)
        }
      } catch {
        // Ignore parse errors
      }
    }

    ws.onclose = (ev) => {
      setWsState('disconnected')
      wsRef.current = null
      if (ev.code !== 4401 && ev.code !== 4404) {
        reconnectTimeoutRef.current = setTimeout(() => connectWebSocket(), 3000)
      } else {
        setWsState('error')
      }
    }

    ws.onerror = () => setWsState('error')
  }

  async function loadEvents() {
    try {
      const data = await listEvents(sessionId)
      setEvents(data)
    } catch { /* non-critical */ }
  }

  async function loadRisk() {
    try {
      const data = await getSessionRisk(sessionId)
      setRiskSnapshots(data)
    } catch { /* non-critical */ }
  }

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
    } catch { /* non-critical */ }
  }

  async function loadParticipants() {
    try {
      const data = await listParticipants(sessionId)
      setParticipants(data)
    } catch { /* non-critical */ }
  }

  // ── Handlers ──────────────────────────────────────────────────

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
    const isEnded = session?.status === 'ended'
    const message = isEnded
      ? 'Permanently delete this ended monitoring session and its monitoring history? This action cannot be undone.'
      : 'Are you sure you want to delete this session? This cannot be undone.'
    if (!confirm(message)) return
    setActionLoading(true)
    try {
      await deleteSession(sessionId)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session')
      setActionLoading(false)
    }
  }

  async function handleAddStudent(studentId: string, studentName: string) {
    setAddingStudent(true)
    setError(null)
    try {
      await addRosterEntry(sessionId, studentId, studentName)
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

  async function handleCsvUpload(file: File) {
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
    }
  }

  // ── Render ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <LoadingSkeleton />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="text-center py-16">
        <p className="text-red-500 mb-2">Session not found</p>
        <a href="/dashboard" className="text-primary-600 hover:underline text-sm">
          Back to Dashboard
        </a>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div className="max-w-5xl mx-auto">
        <SessionHeader
          session={session}
          wsState={wsState}
          rosterCount={roster.length}
          error={error}
        />

        {/* Lifecycle Actions (inside header card's border is handled by SessionHeader) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 -mt-6 mb-6 rounded-t-none border-t-0">
          <LifecycleActions
            status={session.status}
            actionLoading={actionLoading}
            onAction={handleLifecycleAction}
            onDelete={handleDelete}
          />
        </div>

        {/* Summary Cards */}
        <SessionSummaryCards riskSnapshots={riskSnapshots} eventCount={events.length} />

        {/* Risk Leaderboard */}
        <RiskTable snapshots={riskSnapshots} onReview={setReviewTarget} />

        {/* Live Monitoring Events */}
        <LiveEventFeed events={events} sessionStatus={session.status} />

        {/* Roster (collapsible, visually secondary) */}
        <RosterSection
          roster={roster}
          addingStudent={addingStudent}
          uploading={uploading}
          uploadResult={uploadResult}
          onAddStudent={handleAddStudent}
          onDeleteEntry={handleDeleteRosterEntry}
          onCsvUpload={handleCsvUpload}
        />

        {/* Privacy notice */}
        <p className="text-center text-xs text-gray-400 py-4">
          Camera analysis runs locally on the student's device. Only monitoring events are sent to ProctorAI.
        </p>

        {/* Participant Review Modal */}
        {reviewTarget && (
          <ParticipantReviewModal
            snapshot={reviewTarget}
            events={events}
            onClose={() => setReviewTarget(null)}
            screenReviewStatus={srStatus}
            screenReviewStream={srStream}
            screenReviewStatusMessage={srMessage}
            onStartScreenReview={() => {
              if (reviewTarget) startScreenReview(reviewTarget.participant_session_id)
            }}
            onEndScreenReview={endScreenReview}
            onResetScreenReview={resetSrStatus}
            sessionIsLive={session.status === 'live'}
          />
        )}
      </div>
    </ErrorBoundary>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Back link placeholder */}
      <div className="h-4 w-32 bg-gray-200 rounded" />
      {/* Header card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex justify-between">
          <div className="space-y-2">
            <div className="h-6 w-64 bg-gray-200 rounded" />
            <div className="h-4 w-40 bg-gray-200 rounded" />
          </div>
          <div className="h-7 w-20 bg-gray-200 rounded-full" />
        </div>
        <div className="h-20 w-full bg-gray-100 rounded-lg" />
      </div>
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
            <div className="h-3 w-16 bg-gray-200 rounded" />
            <div className="h-7 w-10 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
      {/* Table placeholder */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
        <div className="h-5 w-40 bg-gray-200 rounded" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 w-full bg-gray-100 rounded" />
        ))}
      </div>
    </div>
  )
}

// ── WS Event Enrichment ──────────────────────────────────────────

/**
 * Enrich a raw WS monitoring_event payload into a properly-typed MonitoringEvent.
 *
 * The backend broadcast_event() sends participant_session_id, student_id,
 * student_name as flat fields — MonitoringEvent expects them nested under
 * `participant`. This helper:
 *
 *   1. Preserves an already-nested participant (REST-shaped payloads).
 *   2. Reconstructs participant from flat WS fields.
 *   3. Falls back to risk-snapshot collection for identity.
 *   4. Leaves participant undefined when no source is available —
 *      defensive rendering (?. / ??) handles the fallback gracefully.
 */
function enrichMonitoringEvent(
  raw: Record<string, unknown>,
  snapshots: ParticipantRiskSnapshot[]
): MonitoringEvent {
  let participant: NonNullable<MonitoringEvent['participant']> | undefined
  if (raw.participant && typeof raw.participant === 'object') {
    participant = raw.participant as NonNullable<MonitoringEvent['participant']>
  } else {
    const psid = raw.participant_session_id as string | undefined
    const sid = raw.student_id as string | undefined
    const sname = raw.student_name as string | undefined

    if (psid && sid && sname) {
      participant = {
        participant_session_id: psid,
        student_id: sid,
        student_name: sname,
      }
    } else if (psid) {
      const snap = snapshots.find((s) => s.participant_session_id === psid)
      if (snap) {
        participant = {
          participant_session_id: snap.participant_session_id,
          student_id: snap.student_id,
          student_name: snap.student_name,
        }
      }
    }
  }

  return {
    event_id: raw.event_id as string,
    event_type: raw.event_type as EventType,
    severity: raw.severity as Severity,
    confidence: (raw.confidence as number | null | undefined) ?? null,
    client_event_id: (raw.client_event_id as string | null | undefined) ?? null,
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
    received_at: raw.received_at as string,
    participant,
  }
}

export default SessionDetail
