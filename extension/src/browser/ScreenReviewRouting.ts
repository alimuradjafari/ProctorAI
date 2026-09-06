/**
 * Pure routing-decision helpers for screen-review message delivery.
 *
 * These functions are free of Chrome API dependencies so they can be
 * tested without mocking.  The service worker calls `decideRoutingTarget`
 * with the monitored tab's ID and URL, then acts on the returned decision.
 *
 * Key invariant (Phase 13E production fix):
 *   `tab.url` is `undefined` when the extension lacks the broad `tabs`
 *   permission or `<all_urls>` in host_permissions.  This is NORMAL in
 *   the production build, which intentionally scopes host_permissions to
 *   a single production domain.  An undefined URL must NOT disqualify a
 *   tab — the manifest static content script (`<all_urls>`) is already
 *   loaded in every injectable tab regardless.
 *
 * Only KNOWN restricted schemes (chrome://, edge://, about:, etc.) are
 * rejected.
 */

/**
 * Returns true when `url` is a string whose scheme is known to block
 * content-script injection.  Returns false for `undefined` (URL hidden
 * by Chrome permissions) and for injectable schemes (http/https/file).
 */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (url === undefined) return false
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://') ||
    url.startsWith('chrome-search://')
  )
}

/**
 * Returns true when `url` is a known injectable scheme (http, https, file).
 * Returns false for `undefined` — use `isRestrictedUrl` to distinguish
 * "unknown but probably injectable" from "definitely restricted".
 */
export function isInjectableUrl(url: string | undefined): boolean {
  if (url === undefined) return false
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('file://')
  )
}

// ---------------------------------------------------------------------------
// Routing decision
// ---------------------------------------------------------------------------

export type RoutingDecision =
  | { action: 'ping' }
  | { action: 'find-fallback' }
  | { action: 'reject'; reason: string }

/**
 * Decide how to route a screen-review message based on the monitored
 * tab's URL.
 *
 *  - Restricted URL (chrome://, etc.) → search for a fallback tab.
 *  - Injectable URL (http/https/file) → PING the tab directly.
 *  - `undefined` (URL hidden by Chrome permissions) → PING the tab
 *    directly.  The manifest content script is present on injectable
 *    pages regardless of host_permissions.
 */
export function decideRoutingTarget(
  _tabId: number,
  url: string | undefined,
): RoutingDecision {
  if (isRestrictedUrl(url)) {
    return { action: 'find-fallback' }
  }
  // injectable or undefined → ping the monitored tab
  return { action: 'ping' }
}

// ---------------------------------------------------------------------------
// Fallback tab search
// ---------------------------------------------------------------------------

/** Minimal subset of chrome.tabs.Tab used by the fallback search. */
export interface TabCandidate {
  id?: number
  url?: string
}

/**
 * Pick the best tab from the exam window for a screen-review fallback.
 *
 * Preference order:
 *   1. A tab with a known injectable URL (http/https/file).
 *   2. A tab with `undefined` URL (URL hidden, but likely injectable).
 *
 * Tabs with a known restricted URL (chrome://, etc.) are never selected.
 */
export function findBestTabInWindow(
  tabs: readonly TabCandidate[],
): number | null {
  let firstUndefinedId: number | null = null

  for (const tab of tabs) {
    if (tab.id === undefined) continue
    if (isRestrictedUrl(tab.url)) continue

    // Known injectable URL — best candidate
    if (isInjectableUrl(tab.url)) return tab.id

    // undefined URL — viable fallback (content script is loaded via manifest)
    if (tab.url === undefined && firstUndefinedId === null) {
      firstUndefinedId = tab.id
    }
  }

  return firstUndefinedId
}
