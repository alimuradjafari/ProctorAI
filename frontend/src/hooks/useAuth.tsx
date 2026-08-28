import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { authService, type Instructor } from '../services/auth'

interface AuthContextType {
  instructor: Instructor | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (fullName: string, email: string, password: string) => Promise<void>
  logout: () => void
  refreshMe: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [instructor, setInstructor] = useState<Instructor | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshMe = useCallback(async () => {
    if (!authService.isAuthenticated()) {
      setInstructor(null)
      setLoading(false)
      return
    }
    try {
      const me = await authService.getMe()
      setInstructor(me)
    } catch {
      authService.logout()
      setInstructor(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshMe()
  }, [refreshMe])

  const login = async (email: string, password: string) => {
    await authService.login(email, password)
    const me = await authService.getMe()
    setInstructor(me)
  }

  const register = async (fullName: string, email: string, password: string) => {
    await authService.register(fullName, email, password)
  }

  const logout = () => {
    authService.logout()
    setInstructor(null)
  }

  return (
    <AuthContext.Provider value={{ instructor, loading, login, register, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
