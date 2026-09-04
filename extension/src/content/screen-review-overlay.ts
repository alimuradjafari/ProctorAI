/**
 * Screen review overlay content script.
 *
 * Renders a consent dialog and active-sharing indicator on the exam page.
 * Uses Shadow DOM for CSS isolation from the host page.
 *
 * This script does NOT inspect page content, exam questions, form fields,
 * clipboard, or send page text. It only renders UI for screen review consent.
 */

console.log('[ProctorAI] Screen review overlay content script loaded')

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let shadowHost: HTMLDivElement | null = null
let shadowRoot: ShadowRoot | null = null
let currentReviewId: string | null = null

// ---------------------------------------------------------------------------
// CSS (injected into Shadow DOM)
// ---------------------------------------------------------------------------

const OVERLAY_CSS = `
  :host {
    all: initial;
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #1f2937;
  }

  .container {
    background: #ffffff;
    border-radius: 12px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.1);
    padding: 20px;
    max-width: 360px;
    min-width: 300px;
    border: 1px solid #e5e7eb;
  }

  .title {
    font-size: 16px;
    font-weight: 600;
    color: #111827;
    margin: 0 0 12px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .title-icon {
    width: 20px;
    height: 20px;
    background: #3b82f6;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  .body {
    color: #4b5563;
    margin: 0 0 16px 0;
    font-size: 13px;
  }

  .privacy-note {
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-radius: 8px;
    padding: 10px 12px;
    margin: 0 0 16px 0;
    font-size: 12px;
    color: #0369a1;
  }

  .privacy-note p {
    margin: 0 0 4px 0;
  }

  .privacy-note p:last-child {
    margin-bottom: 0;
  }

  .buttons {
    display: flex;
    gap: 8px;
  }

  .btn {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: background 0.15s, opacity 0.15s;
  }

  .btn:hover {
    opacity: 0.9;
  }

  .btn-primary {
    background: #3b82f6;
    color: #ffffff;
  }

  .btn-primary:hover {
    background: #2563eb;
  }

  .btn-secondary {
    background: #f3f4f6;
    color: #374151;
    border: 1px solid #d1d5db;
  }

  .btn-secondary:hover {
    background: #e5e7eb;
  }

  .btn-danger {
    background: #ef4444;
    color: #ffffff;
    font-size: 12px;
    padding: 6px 12px;
  }

  .btn-danger:hover {
    background: #dc2626;
  }

  /* Active sharing indicator */
  .active-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 10px;
  }

  .active-dot {
    width: 10px;
    height: 10px;
    background: #ef4444;
    border-radius: 50%;
    animation: pulse 2s infinite;
    flex-shrink: 0;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .active-text {
    flex: 1;
    font-size: 13px;
    color: #991b1b;
    font-weight: 500;
  }

  .active-sub {
    font-size: 11px;
    color: #b91c1c;
    font-weight: 400;
    display: block;
    margin-top: 2px;
  }
`

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function ensureShadowHost(): void {
  if (shadowHost) return

  shadowHost = document.createElement('div')
  shadowHost.id = 'proctorai-screen-review-overlay'
  shadowRoot = shadowHost.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = OVERLAY_CSS
  shadowRoot.appendChild(style)

  document.body.appendChild(shadowHost)
}

function clearContent(): void {
  if (!shadowRoot) return
  // Remove everything except the <style> element
  const children = Array.from(shadowRoot.children)
  for (const child of children) {
    if (child.tagName !== 'STYLE') {
      child.remove()
    }
  }
}

function removeOverlay(): void {
  if (shadowHost && shadowHost.parentNode) {
    shadowHost.parentNode.removeChild(shadowHost)
  }
  shadowHost = null
  shadowRoot = null
  currentReviewId = null
}

// ---------------------------------------------------------------------------
// Consent UI
// ---------------------------------------------------------------------------

function showConsentUI(reviewId: string): void {
  ensureShadowHost()
  clearContent()
  if (!shadowRoot) return

  currentReviewId = reviewId

  const container = document.createElement('div')
  container.className = 'container'

  container.innerHTML = `
    <h3 class="title">
      <span class="title-icon"></span>
      Live Screen Review Requested
    </h3>
    <p class="body">
      Your instructor has requested temporary live screen access for review.
    </p>
    <div class="privacy-note">
      <p>Only your screen video will be shared live.</p>
      <p>No microphone audio will be captured.</p>
      <p>The screen is not recorded or stored by ProctorAI.</p>
    </div>
    <div class="buttons">
      <button class="btn btn-primary" id="proctorai-share-btn">Share Entire Screen</button>
      <button class="btn btn-secondary" id="proctorai-decline-btn">Decline</button>
    </div>
  `

  shadowRoot.appendChild(container)

  // Attach event listeners
  const shareBtn = shadowRoot.getElementById('proctorai-share-btn')
  const declineBtn = shadowRoot.getElementById('proctorai-decline-btn')

  shareBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      target: 'service-worker',
      type: 'SCREEN_REVIEW_CONSENT',
      accepted: true,
      screen_review_id: currentReviewId,
    }).catch(() => {})
    // Don't remove overlay yet — switch to active mode after sharing starts
    clearContent()
  })

  declineBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      target: 'service-worker',
      type: 'SCREEN_REVIEW_CONSENT',
      accepted: false,
      screen_review_id: currentReviewId,
    }).catch(() => {})
    removeOverlay()
  })
}

// ---------------------------------------------------------------------------
// Active sharing indicator
// ---------------------------------------------------------------------------

function showActiveIndicator(reviewId: string): void {
  ensureShadowHost()
  clearContent()
  if (!shadowRoot) return

  currentReviewId = reviewId

  const banner = document.createElement('div')
  banner.className = 'active-banner'

  banner.innerHTML = `
    <span class="active-dot"></span>
    <div class="active-text">
      Live Screen Review Active
      <span class="active-sub">Your screen is being shared with your instructor.</span>
    </div>
    <button class="btn btn-danger" id="proctorai-stop-btn">Stop</button>
  `

  shadowRoot.appendChild(banner)

  const stopBtn = shadowRoot.getElementById('proctorai-stop-btn')
  stopBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      target: 'service-worker',
      type: 'SCREEN_REVIEW_STOP_FROM_STUDENT',
      screen_review_id: currentReviewId,
    }).catch(() => {})
    removeOverlay()
  })
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

// Early ping listener — must be registered BEFORE the main listener
// so that sendResponse is called before the main listener returns undefined.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PING_SCREEN_REVIEW_OVERLAY') {
    sendResponse({ ok: true })
    return true
  }
})

chrome.runtime.onMessage.addListener((message) => {
  // Only handle screen review overlay messages
  if (!message || typeof message.type !== 'string') return

  switch (message.type) {
    case 'SHOW_SCREEN_REVIEW_CONSENT': {
      const reviewId = message.screen_review_id as string
      if (reviewId) {
        showConsentUI(reviewId)
      }
      break
    }

    case 'SHOW_SCREEN_REVIEW_ACTIVE': {
      const reviewId = message.screen_review_id as string
      if (reviewId) {
        showActiveIndicator(reviewId)
      }
      break
    }

    case 'HIDE_SCREEN_REVIEW_OVERLAY': {
      removeOverlay()
      break
    }
  }
})

console.log('[ProctorAI] Screen review overlay listener registered')
