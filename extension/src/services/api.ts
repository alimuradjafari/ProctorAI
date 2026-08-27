// ProctorAI API Service Abstraction
// Centralizes all backend communication

const API_BASE_URL = 'http://localhost:8000/api'

export interface HealthResponse {
  status: string
  service: string
  version: string
}

class ApiService {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async healthCheck(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`)
    if (!response.ok) {
      throw new Error('Health check failed')
    }
    return response.json()
  }

  // Future: add authenticated request methods
  // Future: add event publishing methods
  // Future: add session join methods
}

export const apiService = new ApiService(API_BASE_URL)
