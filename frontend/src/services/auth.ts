import { apiClient, ApiError } from './api'

export interface Instructor {
  id: number
  full_name: string
  email: string
  role: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

export interface RefreshResponse {
  access_token: string
  token_type: string
  expires_in: number
}

class AuthService {
  async register(fullName: string, email: string, password: string): Promise<Instructor> {
    return apiClient.post<Instructor>('/auth/register', {
      full_name: fullName,
      email,
      password,
    })
  }

  async login(email: string, password: string): Promise<TokenResponse> {
    const data = await apiClient.post<TokenResponse>('/auth/login', {
      email,
      password,
    })
    localStorage.setItem('access_token', data.access_token)
    localStorage.setItem('refresh_token', data.refresh_token)
    return data
  }

  async getMe(): Promise<Instructor> {
    return apiClient.get<Instructor>('/auth/me')
  }

  logout(): void {
    apiClient.clearTokens()
  }

  isAuthenticated(): boolean {
    return !!localStorage.getItem('access_token')
  }
}

export const authService = new AuthService()
export { ApiError }
