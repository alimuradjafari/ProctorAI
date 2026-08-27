// ProctorAI Extension - Shared Types

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

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
