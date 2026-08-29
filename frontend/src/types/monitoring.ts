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

export interface Participant {
  participant_session_id: string
  student_id: string
  student_name: string
  status: string
  joined_at: string
  last_seen_at: string | null
}

// Monitoring Events (Phase 4)
export type EventType =
  | 'phone_detected'
  | 'multiple_faces'
  | 'suspicious_object'
  | 'no_face'
  | 'fullscreen_exit'
  | 'tab_switch'
  | 'camera_obscured'
  | 'looking_away'
  | 'window_minimized'
  | 'window_maximized'
  | 'window_restored'

export type Severity = 'low' | 'medium' | 'high'

export interface MonitoringEvent {
  event_id: string
  event_type: EventType
  severity: Severity
  confidence: number | null
  client_event_id: string | null
  metadata: Record<string, unknown>
  received_at: string
  participant: {
    participant_session_id: string
    student_id: string
    student_name: string
  }
}

export type WsConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'
