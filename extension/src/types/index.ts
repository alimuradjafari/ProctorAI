// ProctorAI Extension - Shared Types

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// Stored in chrome.storage.local
export interface ParticipantSession {
  participant_access_token: string
  participant_session_id: string
  student_id: string
  student_name: string
  exam_code: string
  title: string
  course_name: string | null
  session_status: string
  status: string
}

export interface JoinRequest {
  exam_code: string
  student_id: string
  student_name: string
}

export interface JoinResponse {
  participant_session_id: string
  participant_access_token: string
  token_type: string
  participant: {
    student_id: string
    student_name: string
    status: string
    joined_at: string
  }
  monitoring_session: {
    exam_code: string
    title: string
    course_name: string | null
    status: string
    join_mode: string
  }
}

export interface ParticipantMeResponse {
  participant_session_id: string
  student_id: string
  student_name: string
  status: string
  joined_at: string
  exam_code: string
  title: string
  course_name: string | null
  session_status: string
}

export type EventType =
  | 'PHONE_DETECTED'
  | 'MULTIPLE_FACES'
  | 'SUSPICIOUS_OBJECT'
  | 'NO_FACE'
  | 'FULLSCREEN_EXIT'
  | 'TAB_SWITCH'
  | 'CAMERA_OBSCURED'
  | 'LOOKING_AWAY'

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface MonitoringEvent {
  event_id: string
  participant_session_id: string
  monitoring_session_id: string
  event_type: EventType
  severity: Severity
  confidence: number
  occurred_at: string
  duration_seconds?: number
  metadata?: Record<string, unknown>
  evidence_id?: string
  created_at: string
}
