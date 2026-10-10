const status = document.getElementById('status')!
const accept = document.getElementById('accept') as HTMLButtonElement
const decline = document.getElementById('decline') as HTMLButtonElement
let reviewId: string | null = null
async function checkRequest() {
  const result = await chrome.runtime.sendMessage({ type: 'GET_SCREEN_REVIEW_REQUEST' })
  reviewId = result?.screen_review_id ?? null
  accept.disabled = decline.disabled = !reviewId
  status.textContent = reviewId ? 'Share only if you agree. You can stop sharing at any time.' : 'This request has ended. You can close this tab.'
}
async function respond(accepted: boolean) {
  accept.disabled = decline.disabled = true
  const response = await chrome.runtime.sendMessage({ target: 'service-worker', type: 'SCREEN_REVIEW_CONSENT', screen_review_id: reviewId, accepted })
  status.textContent = response?.ok ? (accepted ? 'Select your screen in Chrome’s sharing dialog.' : 'Request declined.') : 'This request has ended. Ask your instructor to send a new request.'
}
accept.onclick = () => { void respond(true) }
decline.onclick = () => { void respond(false) }
void checkRequest().catch(() => { status.textContent = 'Unable to reach ProctorAI. Reload the extension and rejoin the exam.' })
export {}
