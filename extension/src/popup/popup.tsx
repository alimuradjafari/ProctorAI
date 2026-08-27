import { createRoot } from 'react-dom/client'
import './popup.css'

function Popup() {
  return (
    <div className="popup-container">
      <div className="popup-header">
        <div className="logo">P</div>
        <h1>ProctorAI</h1>
      </div>
      <p className="subtitle">Exam monitoring extension</p>
      <div className="status-box">
        <span className="status-dot disconnected" />
        <span className="status-text">Not connected to an exam</span>
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<Popup />)
