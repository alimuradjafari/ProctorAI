import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  plugins: [
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
})
