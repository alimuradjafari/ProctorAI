import { Outlet, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

function DashboardLayout() {
  const { instructor, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">P</span>
              </div>
              <span className="text-xl font-semibold text-gray-900">ProctorAI</span>
            </div>
            <nav className="flex items-center space-x-4">
              <Link
                to="/dashboard"
                className="text-sm font-medium text-gray-600 hover:text-primary-600 transition-colors"
              >
                Dashboard
              </Link>
              {instructor && (
                <span className="text-sm text-gray-500">
                  Welcome, <span className="font-medium text-gray-700">{instructor.full_name}</span>
                </span>
              )}
              <button
                onClick={handleLogout}
                className="text-sm font-medium text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
              >
                Logout
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  )
}

export default DashboardLayout
