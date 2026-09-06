# Chrome Web Store — ProctorAI Extension

## Release Information

| Field            | Value                                      |
|------------------|--------------------------------------------|
| Extension Name   | ProctorAI                                  |
| Version          | 0.2.0                                      |
| Manifest Version | 3                                          |
| Distribution     | **Unlisted**                               |
| Target ZIP       | `ProctorAI-0.2.0-chrome-web-store.zip`     |
| Minimum Chrome   | 116                                        |

## Build & Package

### Prerequisites

```bash
cd extension
npm install
```

### Production Build

```bash
# From the extension directory
node node_modules/vite/bin/vite.js build --mode production
```

This produces `extension/dist/` with:
- All JS bundles (service worker, popup, offscreen, content scripts)
- WASM files (MediaPipe vision tasks)
- ML model files (.tflite, .task)
- Icons (16/32/48/128 px)
- **Production-only** `manifest.json` (localhost entries removed)

### Create Upload ZIP

```bash
# From the project root
node scripts/create-zip.cjs
```

This creates `ProctorAI-0.2.0-chrome-web-store.zip` at the project root.
The ZIP root directly contains `manifest.json` — no parent folder wrapping.

## Permissions

### Declared Permissions

| Permission       | Justification |
|------------------|---------------|
| `storage`        | Persist participant session tokens and camera monitoring preferences across extension restarts. |
| `offscreen`      | Run long-lived camera MediaStream, optional screen-capture MediaStream, and MediaPipe ML inference in an offscreen document (required by MV3 — service workers cannot hold media streams). Also hosts the WebRTC peer connection for live screen sharing. |
| `scripting`      | Inject the screen-review consent overlay content script into the active tab when a proctor initiates a screen review request. |

### Host Permissions

| Host Pattern                                             | Environment | Justification |
|----------------------------------------------------------|-------------|---------------|
| `https://proctorai-production-f994.up.railway.app/*`    | Production  | Connect to the ProctorAI backend API for participant registration, monitoring event delivery, and WebRTC signaling. |
| `http://localhost:8000/*`                                | Development | Local development only — removed in production builds. |
| `http://127.0.0.1:8000/*`                                | Development | Local development only — removed in production builds. |

The production build contains **only** the Railway host. The `manifestHostInjectionPlugin` in `vite.config.ts` replaces localhost entries with the production host at build time.

### Content Script Match Pattern: `<all_urls>`

Both content scripts (`content.js` and `screen-review-overlay.js`) use `<all_urls>` as their match pattern. This is required because:

1. **Exam monitoring** — The extension must monitor browser behavior (tab focus, window geometry, side-panel detection) on whatever page the exam is hosted. Exam platforms vary by institution and are not known in advance.
2. **Screen review overlay** — The consent dialog must be injectable on any page the participant is viewing when a proctor requests screen sharing.

The content scripts perform **no data collection from the page DOM** — they only observe browser-level signals (focus, window dimensions) and render a consent overlay when requested.

### CSP: `wasm-unsafe-eval`

The content security policy includes `wasm-unsafe-eval` because MediaPipe's vision tasks (face detection, object detection) are compiled to WebAssembly and require WASM evaluation. Without this directive, the ML inference pipeline cannot load or execute.

All WASM files are bundled locally within the extension (`dist/wasm/`) — no remote code or WASM is fetched.

## Privacy & Data Handling

### Camera Privacy

- Camera is accessed **only** through `getUserMedia({ video: { facingMode: 'user' }, audio: false })`.
- Video frames are processed **entirely on-device** inside the offscreen document.
- ML inference (face detection, object detection, head orientation, frame integrity) runs locally using MediaPipe WASM.
- **Camera frames and pixels never leave the user's device.** Only derived detection event metadata (event type, confidence score, timestamp) is sent to the ProctorAI backend.

### No Microphone

- Every `getUserMedia` call specifies `audio: false`.
- The extension never requests, accesses, or processes microphone audio.

### No Recording

- Camera video is **not recorded** or stored.
- Screen sharing streams are **not recorded** or stored.
- Both camera and screen data exist only as transient in-memory MediaStreams used for real-time processing or peer-to-peer WebRTC transmission.

### Screen Sharing Consent

Screen sharing uses a **two-layer consent** model:

1. **Extension consent dialog** — A Shadow DOM overlay presents a clear explanation of what will be shared, with explicit "Share Entire Screen" and "Decline" buttons. Privacy notes state: "No microphone audio" and "screen is not recorded or stored."
2. **Chrome native picker** — After the user consents in the extension, Chrome's built-in `getDisplayMedia()` picker appears in the offscreen document, giving the user final control over which screen/window/tab to share.

Screen sharing is **always initiated by the proctor** and **always requires participant approval**. The participant can decline at any time.

## UNLISTED Distribution

This extension is published as **Unlisted** on the Chrome Web Store:

- Not discoverable through Chrome Web Store search or browsing.
- Accessible only via direct link.
- Intended for institutional distribution where the exam administrator provides the installation link to participants.

## Manual Chrome Web Store Upload Steps

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Click **New Item** → upload `ProctorAI-0.2.0-chrome-web-store.zip`.
3. Fill in the store listing:
   - **Summary**: One-line description of the extension.
   - **Description**: Detailed description including single-purpose statement.
   - **Category**: Education.
   - **Language**: English.
4. Provide a **Privacy Policy URL** (required for extensions that use camera and screen sharing).
5. Fill in the **Privacy Practices** tab:
   - Declare that the extension does not collect personal data from pages.
   - Declare that camera/screen data is processed locally and not stored.
6. Set **Distribution** to **Unlisted**.
7. Submit for review.

## Source Manifest vs. Production Manifest

| Field              | Source (`public/manifest.json`) | Production (`dist/manifest.json`) |
|--------------------|--------------------------------|-----------------------------------|
| `host_permissions` | `localhost:8000`, `127.0.0.1:8000` | `proctorai-production-f994.up.railway.app` only |
| `icons`            | Same 4 PNGs                    | Same 4 PNGs                       |
| `permissions`      | 3 permissions                  | 3 permissions (unchanged)         |
| `version`          | 0.2.0                          | 0.2.0                             |
| `manifest_version` | 3                              | 3                                 |

The `manifestHostInjectionPlugin` in `vite.config.ts` handles this transformation automatically at build time based on the `VITE_PROD_API_HOST` environment variable from `.env.production`.
