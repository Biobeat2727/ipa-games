import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // tmp/ holds the browser-driving test harness: Chrome profiles, screenshots,
  // logs. Watching it makes every Chrome cache write a full-page reload on all
  // connected clients (the polling watcher sees them all), which blanks the host
  // mid-test. Nothing under tmp/ is application source.
  server: { watch: { usePolling: true, ignored: ['**/tmp/**'] } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      // Additive (globPatterns would REPLACE the defaults): keeps the join QR
      // available even if the network hiccups at the venue.
      includeAssets: ['qr-join.png'],
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Never precache index.html — always fetch fresh from network so stale
        // HTML with old asset hashes never gets served after a redeploy.
        globIgnores: ['**/index.html'],
      },
      manifest: {
        name: 'Tapped In!',
        short_name: 'Tapped In',
        start_url: '/play',
        display: 'standalone',
        theme_color: '#1a1a2e',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
})
