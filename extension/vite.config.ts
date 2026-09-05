import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import type { Plugin } from 'vite'

/**
 * Vite plugin that controls the Chrome extension manifest's host_permissions
 * at build time.
 *
 * Development builds: manifest is copied as-is (localhost only).
 * Production builds: host_permissions are REPLACED with only the production
 * backend host from VITE_PROD_API_HOST, removing localhost entries so the
 * Chrome Web Store submission contains the minimum required host scope.
 *
 * This avoids hard-coding a cloud domain in source while keeping the
 * development experience intact.
 */
function manifestHostInjectionPlugin(mode: string, env: Record<string, string>): Plugin {
  return {
    name: 'manifest-host-injection',
    closeBundle() {
      if (mode !== 'production') return
      // Read from Vite's resolved env (which includes .env.production),
      // with process.env as fallback for CI environments.
      const prodHost = env.VITE_PROD_API_HOST || process.env.VITE_PROD_API_HOST
      if (!prodHost) return

      const manifestPath = resolve('dist', 'manifest.json')
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
        // Production: REPLACE host_permissions with only the production host.
        // Localhost entries from the source manifest are intentionally removed
        // so the Web Store build has minimum-necessary scope.
        const perm = `${prodHost}/*`
        manifest.host_permissions = [perm]
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
        console.log(`[manifest] Set production host_permissions: [${perm}]`)
      } catch (err) {
        console.warn('[manifest] Could not modify manifest:', err)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  return {
  plugins: [
    manifestHostInjectionPlugin(mode, env),
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
}})
