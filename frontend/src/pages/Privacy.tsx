import { Link } from 'react-router-dom'

function Privacy() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">P</span>
              </div>
              <span className="text-xl font-semibold text-gray-900">ProctorAI</span>
            </Link>
            <Link
              to="/login"
              className="text-sm font-medium text-gray-600 hover:text-primary-600 transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="bg-white rounded-2xl shadow-lg p-8 sm:p-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
          <p className="text-sm text-gray-500 mb-8">Last Updated: September 2026</p>

          {/* Single-Purpose Statement */}
          <div className="bg-primary-50 border border-primary-200 rounded-xl p-5 mb-10">
            <p className="text-sm text-primary-900 leading-relaxed">
              <strong>Single Purpose:</strong> ProctorAI&rsquo;s single purpose is to provide
              real-time exam monitoring signals and consent-based live screen review during
              authorized examination sessions.
            </p>
          </div>

          <div className="prose prose-sm prose-gray max-w-none text-gray-700 space-y-10">
            {/* 1. Overview */}
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">1. Overview</h2>
              <p className="leading-relaxed">
                ProctorAI is a real-time exam monitoring system consisting of a Chrome browser
                extension and a backend service. The extension is used only during an authorized
                monitoring session initiated by an instructor. This policy describes what
                ProctorAI does, what data it processes, and how that data is handled.
              </p>
            </section>

            {/* 2. What ProctorAI Does NOT Do */}
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                2. What ProctorAI Does NOT Do
              </h2>
              <ul className="list-disc pl-6 space-y-2 leading-relaxed">
                <li>
                  <strong>No face recognition or biometric identity matching.</strong> Camera
                  frames are analyzed locally to detect the presence and orientation of a face
                  using MediaPipe, but no facial identity is extracted, compared, or stored.
                </li>
                <li>
                  <strong>No camera images or video frames are uploaded or stored.</strong> All
                  camera processing occurs on the student&rsquo;s device. Only derived event
                  metadata (e.g., &ldquo;no face detected&rdquo;) is transmitted.
                </li>
                <li>
                  <strong>No screenshots or evidence recordings</strong> are created at any point.
                </li>
                <li>
                  <strong>No microphone or speech monitoring.</strong> Every camera request
                  explicitly sets <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">audio: false</code>.
                  Audio is never captured.
                </li>
                <li>
                  <strong>No keystroke logging.</strong> The extension does not monitor or record
                  keyboard input.
                </li>
                <li>
                  <strong>No page-content scraping.</strong> The extension does not read, extract,
                  or transmit the content of web pages.
                </li>
                <li>
                  <strong>No form-data collection.</strong> Form fields are never read or
                  intercepted.
                </li>
                <li>
                  <strong>No cookies or browsing-history collection.</strong>
                </li>
                <li>
                  <strong>No personalized advertising.</strong> ProctorAI does not use monitoring
                  data for advertising purposes.
                </li>
              </ul>
            </section>

            {/* 3. Monitoring Event Metadata */}
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                3. Monitoring Event Metadata
              </h2>
              <p className="leading-relaxed mb-3">
                During an active monitoring session, the extension may generate monitoring-event
                metadata necessary for exam integrity. The types of events that may be detected
                include:
              </p>
              <ul className="list-disc pl-6 space-y-1 leading-relaxed mb-4">
                <li>Tab switch</li>
                <li>Fullscreen exit</li>
                <li>Window minimized or restored</li>
                <li>Exam-window focus lost</li>
                <li>Browser side panel opened</li>
                <li>No face detected</li>
                <li>Multiple faces detected</li>
                <li>Looking away</li>
                <li>Camera obscured</li>
                <li>Phone or suspicious object detected</li>
              </ul>
              <p className="leading-relaxed">
                Only event metadata required for monitoring is sent to the ProctorAI backend.
                This metadata includes the event type, a timestamp, detection confidence where
                applicable, and the participant/session identifiers required for the monitoring
                session.
              </p>
            </section>

            {/* 4. Live Screen Review */}
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                4. Live Screen Review
              </h2>
              <p className="leading-relaxed mb-3">
                ProctorAI supports an optional live screen review feature that allows an
                instructor to view a student&rsquo;s screen in real time. This feature is
                governed by the following safeguards:
              </p>
              <ul className="list-disc pl-6 space-y-2 leading-relaxed">
                <li>
                  Live screen review only happens when an <strong>instructor requests it</strong>.
                </li>
                <li>
                  The student must <strong>explicitly accept</strong> a ProctorAI consent prompt
                  displayed by the extension.
                </li>
                <li>
                  After consent, Chrome shows its <strong>native screen-selection dialog</strong>,
                  giving the student final control over which screen to share.
                </li>
                <li>
                  Only <strong>screen video</strong> is shared. No microphone audio is captured
                  or transmitted.
                </li>
                <li>
                  Screen sharing uses <strong>WebRTC</strong> for real-time peer-to-peer streaming.
                  The backend is used for signaling only.
                </li>
                <li>
                  Screen video is <strong>not recorded or stored</strong> by ProctorAI.
                </li>
                <li>
                  The student can <strong>stop screen sharing at any time</strong>.
                </li>
              </ul>
            </section>

            {/* 5. Local Extension Storage */}
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                5. Local Extension Storage
              </h2>
              <p className="leading-relaxed mb-3">
                The ProctorAI Chrome extension uses <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">chrome.storage.local</code> to maintain the
                following information on the student&rsquo;s device:
              </p>
              <ul className="list-disc pl-6 space-y-2 leading-relaxed">
                <li>
                  <strong>Participant session:</strong> participant access token, session
                  identifier, student ID, student name, exam code, session title, course name,
                  and session status. This is required to maintain the active monitoring session.
                </li>
                <li>
                  <strong>Camera monitoring state:</strong> whether camera monitoring is enabled
                  and the current camera status (e.g., active, inactive, denied). This is required
                  to recover camera monitoring state after a browser restart.
                </li>
              </ul>
              <p className="leading-relaxed mt-3">
                This data is stored locally on the student&rsquo;s device and is removed when
                the student disconnects from the session or uninstalls the extension.
              </p>
            </section>

            {/* 6. Server Data */}
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">6. Server Data</h2>
              <p className="leading-relaxed">
                Monitoring event metadata and session information are transmitted securely to the
                ProctorAI backend using HTTPS for API traffic and WSS for WebSocket traffic.
                Access to the backend is restricted to authenticated instructor and participant
                sessions. Event and session data is used solely to provide the exam-monitoring
                functionality. ProctorAI does not sell monitoring data and does not use it for
                advertising.
              </p>
            </section>

            {/* 7. Data Sharing */}
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">7. Data Sharing</h2>
              <ul className="list-disc pl-6 space-y-2 leading-relaxed">
                <li>
                  Monitoring event data is available to the <strong>authorized instructor</strong>{' '}
                  for the relevant examination session through the ProctorAI dashboard.
                </li>
                <li>
                  Consent-based live screen video is viewed by the <strong>authorized
                  instructor</strong> through a live WebRTC connection. It is not stored.
                </li>
                <li>
                  ProctorAI <strong>does not sell</strong> monitoring data.
                </li>
                <li>
                  ProctorAI does not share monitoring data with third parties beyond what is
                  described in this policy.
                </li>
              </ul>
            </section>

            {/* 8. Data Retention */}
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">8. Data Retention</h2>
              <p className="leading-relaxed">
                ProctorAI does not enforce an automatic data retention or expiration period.
                Monitoring sessions and their associated event data persist on the server until
                the instructor takes action. Instructors may delete sessions that are in a
                Draft, Cancelled, or Ended state. Deleting a session cascades to remove all
                associated monitoring events and participant records from the database.
              </p>
              <p className="leading-relaxed mt-3">
                Extension-local data (stored in <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">chrome.storage.local</code>) is removed when
                the student disconnects from a session or uninstalls the extension.
              </p>
            </section>

            {/* 9. Security */}
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">9. Security</h2>
              <p className="leading-relaxed">
                ProctorAI uses HTTPS for all API communication and WSS for WebSocket connections.
                Access to monitoring sessions is controlled through authenticated instructor and
                participant tokens. Instructors can only access sessions they own. No system is
                perfectly secure; ProctorAI applies reasonable measures to protect monitoring data
                but cannot guarantee absolute security.
              </p>
            </section>

            {/* 10. Your Choices */}
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">10. Your Choices</h2>
              <ul className="list-disc pl-6 space-y-2 leading-relaxed">
                <li>
                  <strong>Camera permission</strong> can be denied or revoked at any time through
                  Chrome&rsquo;s permission settings. If camera access is denied, the extension
                  continues to monitor browser-level signals (e.g., tab switches, window state)
                  but cannot perform camera-based detection.
                </li>
                <li>
                  <strong>Live screen review</strong> can be declined when the consent prompt
                  appears. Declining does not affect other monitoring functionality.
                </li>
                <li>
                  <strong>Screen sharing</strong> can be stopped at any time by the student during
                  an active live screen review session.
                </li>
                <li>
                  <strong>Removing the extension</strong> removes all extension-local state in
                  accordance with Chrome&rsquo;s standard uninstall behavior.
                </li>
              </ul>
            </section>

            {/* 11. Contact */}
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">11. Contact</h2>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                <p className="text-sm text-amber-900 leading-relaxed font-medium">
                  [alimuradjafari@gmail.com]
                </p>
                <p className="text-sm text-amber-800 leading-relaxed mt-2">
                  For privacy-related questions or concerns about ProctorAI, please contact the
                  address above.
                </p>
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-sm text-gray-400 mt-8 pb-8">
          <p>&copy; {new Date().getFullYear()} ProctorAI. All rights reserved.</p>
        </footer>
      </main>
    </div>
  )
}

export default Privacy
