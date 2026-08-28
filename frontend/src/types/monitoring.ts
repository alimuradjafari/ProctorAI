// Types for monitoring sessions

export type JoinMode = 'open_join' | 'roster_required'
export type SessionStatus = 'draft' | 'waiting' | 'live' | 'ended' | 'cancelled'

export interface MonitoringSession {
  id: number
  exam_code: string
  title: string
  course_name: string | null
  instructor_id: number
  join_mode: JoinMode
  status: SessionStatus
  starts_at: string | null
  ends_at: string | null
  created_at: string
  updated_at: string
}

export interface RosterEntry {
  id: number
  monitoring_session_id: number
  student_id: string
  student_name: string
  created_at: string
}

export interface RosterUploadResponse {
  added: number
  skipped: number
  errors: string[]
}
