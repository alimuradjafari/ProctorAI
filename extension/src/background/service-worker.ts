// ProctorAI Background Service Worker
// Handles extension lifecycle and future background tasks

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('ProctorAI extension installed')
  } else if (details.reason === 'update') {
    console.log('ProctorAI extension updated')
  }
})

// Future: handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    sendResponse({ status: 'idle' })
  }
  return true
})
