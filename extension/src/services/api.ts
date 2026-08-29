// ProctorAI API Service Abstraction
// Centralizes all backend communication

import type {
  JoinRequest,
  JoinResponse,
  ParticipantMeResponse,
  EventSubmissionRequest,
  EventResponse,
} from '../types'

const API_BASE_URL = 'http://localhost:8000/api'

class ApiService {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async joinSession(request: JoinRequest): Promise<JoinResponse> {
    const response = await fetch(`${this.baseUrl}/participant-sessions/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Join failed' }))
      throw new Error(errorData.detail || 'Join failed')
    }
    return response.json()
  }

  async getParticipantMe(token: string): Promise<ParticipantMeResponse> {
    const response = await fetch(`${this.baseUrl}/participant-sessions/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      throw new Error('Session restore failed')
    }
    return response.json()
  }

  /**
   * Submit a monitoring event to the server.
   *
   * SECURITY:
   * - Participant token only — never instructor token
   * - Server resolves: instructor_id, monitoring_session_id, severity
   * - Client NEVER sends: instructor_id, monitoring_session_id, participant_session_id, severity
   *
   * This method is a reusable helper for future detectors (Phase 5+).
   * It is NOT called automatically in Phase 4.
   */
  async sendMonitoringEvent(
    token: string,
    event: EventSubmissionRequest
  ): Promise<EventResponse> {
    const response = await fetch(`${this.baseUrl}/participant-sessions/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(event),
    })

    if (response.status === 401) {
      // Token expired or invalid — clear stored participant session
      await chrome.storage.local.remove('proctorai_session')
      throw new Error('Session expired. Please rejoin the exam.')
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Event submission failed' }))
      throw new Error(errorData.detail || 'Event submission failed')
    }

    return response.json()
  }
}

export const apiService = new ApiService(API_BASE_URL)
