import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isRestrictedUrl,
  isInjectableUrl,
  decideRoutingTarget,
  findBestTabInWindow,
  type TabCandidate,
} from './ScreenReviewRouting'

// ---------------------------------------------------------------------------
// isRestrictedUrl
// ---------------------------------------------------------------------------

describe('isRestrictedUrl', () => {
  it('returns false for undefined (URL hidden by permissions)', () => {
    assert.strictEqual(isRestrictedUrl(undefined), false)
  })

  it('rejects chrome:// URLs', () => {
    assert.strictEqual(isRestrictedUrl('chrome://newtab/'), true)
    assert.strictEqual(isRestrictedUrl('chrome://settings'), true)
  })

  it('rejects chrome-extension:// URLs', () => {
    assert.strictEqual(isRestrictedUrl('chrome-extension://abcdefg/popup.html'), true)
  })

  it('rejects edge:// URLs', () => {
    assert.strictEqual(isRestrictedUrl('edge://settings'), true)
  })

  it('rejects about: URLs', () => {
    assert.strictEqual(isRestrictedUrl('about:blank'), true)
  })

  it('rejects devtools:// URLs', () => {
    assert.strictEqual(isRestrictedUrl('devtools://devtools/bundled/inspector.html'), true)
  })

  it('rejects chrome-search:// URLs', () => {
    assert.strictEqual(isRestrictedUrl('chrome-search://local-ntp/local-ntp.html'), true)
  })

  it('does NOT reject http/https/file URLs', () => {
    assert.strictEqual(isRestrictedUrl('http://example.com'), false)
    assert.strictEqual(isRestrictedUrl('https://example.com/exam'), false)
    assert.strictEqual(isRestrictedUrl('file:///home/user/exam.html'), false)
  })

  it('does NOT reject other schemes (data:, ftp:, etc.)', () => {
    assert.strictEqual(isRestrictedUrl('data:text/html,<h1>hi</h1>'), false)
    assert.strictEqual(isRestrictedUrl('ftp://files.example.com'), false)
  })
})

// ---------------------------------------------------------------------------
// isInjectableUrl
// ---------------------------------------------------------------------------

describe('isInjectableUrl', () => {
  it('returns false for undefined', () => {
    assert.strictEqual(isInjectableUrl(undefined), false)
  })

  it('accepts http, https, file', () => {
    assert.strictEqual(isInjectableUrl('http://localhost:8000'), true)
    assert.strictEqual(isInjectableUrl('https://example.com'), true)
    assert.strictEqual(isInjectableUrl('file:///tmp/test.html'), true)
  })

  it('rejects restricted schemes', () => {
    assert.strictEqual(isInjectableUrl('chrome://newtab/'), false)
    assert.strictEqual(isInjectableUrl('edge://settings'), false)
    assert.strictEqual(isInjectableUrl('about:blank'), false)
  })

  it('rejects data: and ftp: schemes', () => {
    assert.strictEqual(isInjectableUrl('data:text/html,<h1>hi</h1>'), false)
    assert.strictEqual(isInjectableUrl('ftp://files.example.com'), false)
  })
})

// ---------------------------------------------------------------------------
// decideRoutingTarget
// ---------------------------------------------------------------------------

describe('decideRoutingTarget', () => {
  it('A. tab with url undefined → ping (not rejected)', () => {
    const decision = decideRoutingTarget(100, undefined)
    assert.deepStrictEqual(decision, { action: 'ping' })
  })

  it('B. tab with undefined URL does NOT automatically reject', () => {
    // Verify the decision is 'ping', not 'reject' or 'find-fallback'
    const decision = decideRoutingTarget(200, undefined)
    assert.notStrictEqual(decision.action, 'reject')
    assert.notStrictEqual(decision.action, 'find-fallback')
    assert.strictEqual(decision.action, 'ping')
  })

  it('tab with injectable http URL → ping', () => {
    assert.deepStrictEqual(
      decideRoutingTarget(300, 'https://example.com/exam'),
      { action: 'ping' }
    )
  })

  it('tab with injectable https URL → ping', () => {
    assert.deepStrictEqual(
      decideRoutingTarget(301, 'http://localhost:3000/test'),
      { action: 'ping' }
    )
  })

  it('tab with file:// URL → ping', () => {
    assert.deepStrictEqual(
      decideRoutingTarget(302, 'file:///home/user/test.html'),
      { action: 'ping' }
    )
  })

  it('D. tab with chrome:// URL → find-fallback', () => {
    assert.deepStrictEqual(
      decideRoutingTarget(400, 'chrome://newtab/'),
      { action: 'find-fallback' }
    )
  })

  it('tab with edge:// URL → find-fallback', () => {
    assert.deepStrictEqual(
      decideRoutingTarget(401, 'edge://settings'),
      { action: 'find-fallback' }
    )
  })

  it('tab with chrome-extension:// URL → find-fallback', () => {
    assert.deepStrictEqual(
      decideRoutingTarget(402, 'chrome-extension://abc/popup.html'),
      { action: 'find-fallback' }
    )
  })

  it('tab with about: URL → find-fallback', () => {
    assert.deepStrictEqual(
      decideRoutingTarget(403, 'about:blank'),
      { action: 'find-fallback' }
    )
  })
})

// ---------------------------------------------------------------------------
// findBestTabInWindow
// ---------------------------------------------------------------------------

describe('findBestTabInWindow', () => {
  it('returns null for empty tabs array', () => {
    assert.strictEqual(findBestTabInWindow([]), null)
  })

  it('returns null when all tabs have restricted URLs', () => {
    const tabs: TabCandidate[] = [
      { id: 1, url: 'chrome://newtab/' },
      { id: 2, url: 'edge://settings' },
      { id: 3, url: 'about:blank' },
    ]
    assert.strictEqual(findBestTabInWindow(tabs), null)
  })

  it('returns null when tabs have no id', () => {
    const tabs: TabCandidate[] = [
      { url: 'https://example.com' },
    ]
    assert.strictEqual(findBestTabInWindow(tabs), null)
  })

  it('prefers known injectable URL over undefined URL', () => {
    const tabs: TabCandidate[] = [
      { id: 10, url: undefined },
      { id: 20, url: 'https://example.com/exam' },
      { id: 30, url: undefined },
    ]
    assert.strictEqual(findBestTabInWindow(tabs), 20)
  })

  it('returns first undefined-URL tab when no injectable URL exists', () => {
    const tabs: TabCandidate[] = [
      { id: 10, url: 'chrome://newtab/' },
      { id: 20, url: undefined },
      { id: 30, url: undefined },
    ]
    assert.strictEqual(findBestTabInWindow(tabs), 20)
  })

  it('skips restricted tabs but accepts undefined URL tabs', () => {
    const tabs: TabCandidate[] = [
      { id: 1, url: 'chrome-extension://abc/popup.html' },
      { id: 2, url: undefined },
    ]
    assert.strictEqual(findBestTabInWindow(tabs), 2)
  })

  it('returns the first injectable URL when multiple exist', () => {
    const tabs: TabCandidate[] = [
      { id: 5, url: 'https://first.com' },
      { id: 6, url: 'https://second.com' },
    ]
    assert.strictEqual(findBestTabInWindow(tabs), 5)
  })

  it('production scenario: all tabs have undefined URL → returns first non-restricted', () => {
    // This is the exact production scenario: host_permissions scoped to one domain,
    // Chrome hides all tab URLs → every tab has url: undefined.
    const tabs: TabCandidate[] = [
      { id: 100, url: undefined },
      { id: 200, url: undefined },
      { id: 300, url: undefined },
    ]
    assert.strictEqual(findBestTabInWindow(tabs), 100)
  })
})
