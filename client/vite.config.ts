import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Align',
        short_name: 'Align',
        description: 'Simple project management, thoughtfully organized.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        screenshots: [
          {
            src: 'screenshot-desktop.png',
            sizes: '1280x720',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Align workspace',
          },
          {
            src: 'screenshot-mobile.png',
            sizes: '750x1334',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Align on a phone',
          },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        importScripts: ['sw-reload.js'],
        // index.html is not precached. Navigations are network-only so a slow
        // response cannot fall back to HTML that points at an old bundle.
        // API GETs are handled in sw-reload.js with a real timeout.
        globPatterns: ['**/*.{js,css,ico,png,svg,webp,webmanifest,woff2}'],
        navigateFallback: undefined,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  envDir: repoRoot,
  server: {
    host: true,
    port: 5173,
    fs: { allow: [repoRoot] },
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
