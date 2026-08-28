import { apiClient } from './api'
import type { MonitoringSession, RosterEntry, RosterUploadResponse, JoinMode, Participant } from '../types/monitoring'

const BASE = '/monitoring-sessions'

// --- Monitoring Sessions ---

export async function listSessions(): Promise<MonitoringSession[]> {
  const data = await apiClient.get<{ sessions: MonitoringSession[] }>(BASE)
  return data.sessions
}

export async function getSession(id: number): Promise<MonitoringSession> {
  return apiClient.get<MonitoringSession>(`${BASE}/${id}`)
}

export async function createSession(params: {
  title: string
  course_name?: string
  join_mode: JoinMode
  starts_at?: string | null
  ends_at?: string | null
}): Promise<MonitoringSession> {
  return apiClient.post<MonitoringSession>(BASE, params)
}

export async function updateSession(id: number, params: {
  title?: string
  course_name?: string
  join_mode?: JoinMode
  starts_at?: string | null
  ends_at?: string | null
}): Promise<MonitoringSession> {
  return apiClient.patch<MonitoringSession>(`${BASE}/${id}`, params)
}

export async function deleteSession(id: number): Promise<void> {
  return apiClient.delete(`${BASE}/${id}`)
}

// --- Lifecycle ---

export async function prepareSession(id: number): Promise<MonitoringSession> {
  return apiClient.post<MonitoringSession>(`${BASE}/${id}/prepare`)
}

export async function startSession(id: number): Promise<MonitoringSession> {
  return apiClient.post<MonitoringSession>(`${BASE}/${id}/start`)
}

export async function endSession(id: number): Promise<MonitoringSession> {
  return apiClient.post<MonitoringSession>(`${BASE}/${id}/end`)
}

export async function cancelSession(id: number): Promise<MonitoringSession> {
  return apiClient.post<MonitoringSession>(`${BASE}/${id}/cancel`)
}

// --- Roster ---

export async function listRoster(sessionId: number): Promise<RosterEntry[]> {
  const data = await apiClient.get<{ entries: RosterEntry[] }>(`${BASE}/${sessionId}/roster`)
  return data.entries
}

export async function addRosterEntry(sessionId: number, studentId: string, studentName: string): Promise<RosterEntry> {
  return apiClient.post<RosterEntry>(`${BASE}/${sessionId}/roster`, {
    student_id: studentId,
    student_name: studentName,
  })
}

export async function deleteRosterEntry(sessionId: number, entryId: number): Promise<void> {
  return apiClient.delete(`${BASE}/${sessionId}/roster/${entryId}`)
}

export async function uploadRosterCsv(sessionId: number, file: File): Promise<RosterUploadResponse> {
  return apiClient.uploadFile<RosterUploadResponse>(`${BASE}/${sessionId}/roster/upload`, file)
}

// --- Participants ---

export async function listParticipants(sessionId: number): Promise<Participant[]> {
  const data = await apiClient.get<{ participants: Participant[] }>(`${BASE}/${sessionId}/participants`)
  return data.participants
}
