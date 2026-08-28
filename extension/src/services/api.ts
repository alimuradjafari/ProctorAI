// ProctorAI API Service Abstraction
// Centralizes all backend communication

import type { JoinRequest, JoinResponse, ParticipantMeResponse } from '../types'

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
}

export const apiService = new ApiService(API_BASE_URL)
