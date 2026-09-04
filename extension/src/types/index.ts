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
  | 'browser_side_panel'
  | 'exam_window_focus_lost'

export type Severity = 'low' | 'medium' | 'high'

// Event submission request — sent by participant to server
// Server resolves: monitoring_session_id, participant_session_id, severity
export interface EventSubmissionRequest {
  event_type: EventType
  confidence?: number | null
  client_event_id?: string
  client_occurred_at?: string
  metadata?: Record<string, unknown>
}

// Event response — received from server after submission
export interface EventResponse {
  event_id: string
  event_type: string
  severity: string
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
