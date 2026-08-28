import { useAuth } from '../hooks/useAuth'

function Dashboard() {
  const { instructor } = useAuth()

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Dashboard</h1>
      <p className="text-gray-600 mb-8">Monitor your exam sessions in real time.</p>

      {instructor && (
        <div className="bg-primary-50 border border-primary-200 rounded-xl p-4 mb-6">
          <p className="text-primary-800 text-sm">
            Welcome back, <span className="font-semibold">{instructor.full_name}</span>.
            You are logged in as <span className="font-medium">{instructor.email}</span>.
          </p>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">
          No monitoring session selected
        </h2>
        <p className="text-gray-500 text-sm">
          Create or select a monitoring session to begin proctoring.
        </p>
        <p className="text-xs text-gray-400 mt-4">
          Session management will be available in Phase 2B.
        </p>
      </div>
    </div>
  )
}

export default Dashboard
