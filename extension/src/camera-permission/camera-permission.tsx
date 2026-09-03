import { createRoot } from 'react-dom/client'
import { useState, useCallback } from 'react'
import './camera-permission.css'

type StatusType = 'idle' | 'requesting' | 'success' | 'denied' | 'notfound' | 'readable' | 'error'

const STATUS_MESSAGES: Record<StatusType, string> = {
  idle: '',
  requesting: 'Requesting camera access...',
  success: 'Camera access granted! Starting monitoring...',
  denied: 'Camera permission denied. Please allow camera access and try again.',
  notfound: 'No camera was found on this device.',
  readable: 'Camera is already in use or unavailable.',
  error: 'An unexpected error occurred while accessing the camera.',
}

function CameraPermission() {
  const [status, setStatus] = useState<StatusType>('idle')
  const [busy, setBusy] = useState(false)

  const handleAllowCamera = useCallback(async () => {
    setBusy(true)
    setStatus('requesting')

    let stream: MediaStream | null = null

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      })

      // Permission granted — immediately stop the temporary stream
      stream.getTracks().forEach((track) => track.stop())
      stream = null

      setStatus('success')

      // Notify the service worker that permission was granted
      await chrome.runtime.sendMessage({
        type: 'CAMERA_PERMISSION_GRANTED',
      })

      // Close this tab after a short delay so the user sees the success message
      setTimeout(() => {
        window.close()
      }, 1500)
    } catch (err) {
      console.error('[ProctorAI] Camera permission failed:', err)

      // Stop any partial stream
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }

      let failStatus: StatusType = 'error'

      if (err instanceof DOMException) {
        switch (err.name) {
          case 'NotAllowedError':
          case 'PermissionDeniedError':
            failStatus = 'denied'
            break
          case 'NotFoundError':
          case 'DevicesNotFoundError':
            failStatus = 'notfound'
            break
          case 'NotReadableError':
          case 'TrackStartError':
            failStatus = 'readable'
            break
        }
      }

      setStatus(failStatus)

      // Notify the service worker that permission failed
      chrome.runtime.sendMessage({
        type: 'CAMERA_PERMISSION_FAILED',
        reason: failStatus,
      }).catch(() => { /* service worker may not be available */ })
    } finally {
      setBusy(false)
    }
  }, [])

  const statusClass =
    status === 'success' ? 'success' :
    status === 'idle' || status === 'requesting' ? 'info' :
    'error'

  return (
    <div className="container">
      <div className="logo">P</div>
      <h1>ProctorAI Camera Permission</h1>
      <p className="description">
        ProctorAI needs camera access for local exam monitoring.
        Video frames remain on this device and are not uploaded.
      </p>

      <button
        className="allow-btn"
        onClick={handleAllowCamera}
        disabled={busy || status === 'success'}
      >
        {status === 'success'
          ? 'Granted'
          : busy
            ? 'Requesting...'
            : 'Allow Camera'}
      </button>

      <p className={`status ${statusClass}`}>
        {STATUS_MESSAGES[status]}
      </p>
    </div>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<CameraPermission />)
