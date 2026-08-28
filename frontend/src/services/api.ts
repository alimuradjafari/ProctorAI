const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private getAuthHeaders(): HeadersInit {
    const token = localStorage.getItem('access_token')
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { ...this.getAuthHeaders() },
    })
    if (response.status === 401) {
      // Try refreshing the token
      const refreshed = await this.refreshAccessToken()
      if (refreshed) {
        // Retry with new token
        const retryResponse = await fetch(`${this.baseUrl}${path}`, {
          headers: { ...this.getAuthHeaders() },
        })
        if (!retryResponse.ok) throw new ApiError(retryResponse.status, await retryResponse.text())
        return retryResponse.json()
      }
      throw new ApiError(401, 'Unauthorized')
    }
    if (!response.ok) throw new ApiError(response.status, await response.text())
    return response.json()
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Request failed' }))
      throw new ApiError(response.status, errorData.detail || 'Request failed')
    }
    return response.json()
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Request failed' }))
      throw new ApiError(response.status, errorData.detail || 'Request failed')
    }
    return response.json()
  }

  async delete(path: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: { ...this.getAuthHeaders() },
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Request failed' }))
      throw new ApiError(response.status, errorData.detail || 'Request failed')
    }
  }

  async uploadFile<T>(path: string, file: File): Promise<T> {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...this.getAuthHeaders() },
      body: formData,
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Request failed' }))
      throw new ApiError(response.status, errorData.detail || 'Request failed')
    }
    return response.json()
  }

  private async refreshAccessToken(): Promise<boolean> {
    const refreshToken = localStorage.getItem('refresh_token')
    if (!refreshToken) return false

    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!response.ok) {
        this.clearTokens()
        return false
      }
      const data = await response.json()
      localStorage.setItem('access_token', data.access_token)
      return true
    } catch {
      this.clearTokens()
      return false
    }
  }

  clearTokens(): void {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
  }
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

export const apiClient = new ApiClient(API_BASE_URL)
