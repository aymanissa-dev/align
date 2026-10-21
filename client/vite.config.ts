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
        // Navigations try the network first. sw-reload.js serves the precached
        // shell only after that fetch rejects, so a slow response is not
        // replaced early. API requests are not cached at all.
        // JS, CSS, and index.html are precached so an unvisited route still has
        // a shell offline. sw-reload.js serves that shell only after a navigation
        // fetch rejects; it does not race a slow network.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,webmanifest,woff2}'],
        // Do not answer a missing hashed file with the app shell. sw-reload.js
        // turns an HTML response for /assets/* into a 404.
        navigateFallback: null,
        navigateFallbackDenylist: [/^\/assets\//, /^\/api\//],
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
