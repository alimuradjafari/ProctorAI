function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-lg">P</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">ProctorAI</h1>
          <p className="text-gray-500 mt-1">Instructor Dashboard Login</p>
        </div>

        <div className="bg-gray-100 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-600">
            Authentication will be available in Phase 2.
          </p>
        </div>
      </div>
    </div>
  )
}

export default Login
