import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import type { Plugin } from 'vite'

/**
 * Vite plugin that injects the production backend host into the Chrome
 * extension manifest's host_permissions at build time.
 *
 * Development builds: manifest is copied as-is (localhost only).
 * Production builds: if VITE_PROD_API_HOST is set, it is appended to
 * host_permissions so the extension can connect to the cloud backend.
 *
 * This avoids hard-coding a fake domain and keeps the manifest source
 * clean — only the built artifact is modified.
 */
function manifestHostInjectionPlugin(mode: string): Plugin {
  return {
    name: 'manifest-host-injection',
    writeBundle(options) {
      if (mode !== 'production') return
      const prodHost = process.env.VITE_PROD_API_HOST
      if (!prodHost) return

      const manifestPath = resolve(options.dir || 'dist', 'manifest.json')
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
        const perm = `${prodHost}/*`
        const existing: string[] = manifest.host_permissions || []
        if (!existing.includes(perm)) {
          manifest.host_permissions = [...existing, perm]
          writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
          console.log(`[manifest] Injected host_permission: ${perm}`)
        }
      } catch (err) {
        console.warn('[manifest] Could not modify manifest:', err)
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    manifestHostInjectionPlugin(mode),
    react(),
    viteStaticCopy({
      targets: [
        // Copy public/* to dist root (manifest, popup.html, models/, etc.)
        { src: 'public/*', dest: '.' },
        // Copy MediaPipe WASM files to dist/wasm/
        {
          src: 'node_modules/@mediapipe/tasks-vision/wasm/*',
          dest: 'wasm',
        },
      ],
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.tsx'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.ts'),
        content: resolve(__dirname, 'src/content/browser-monitor.ts'),
        'screen-review-overlay': resolve(__dirname, 'src/content/screen-review-overlay.ts'),
        'camera-permission': resolve(__dirname, 'src/camera-permission/camera-permission.tsx'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
}))
