/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

/**
 * Mounts the Palm OS service inside the dev and preview servers.
 *
 * Two jobs. The first is fetching: archiving a site needs something outside
 * the browser to do it, because a page cannot read a cross-origin resource its
 * server has not opted into sharing. The second is routing by Host, so that
 * each installed application is served from its own origin
 * (`app-<id>.<host>`) and Palm OS's own document never appears on one.
 *
 * Keeping it here means `npm run dev` works with no second process;
 * `server/proxy.mjs` is the same chain for deployments that serve the bundle
 * from static hosting.
 */
function palmService(): Plugin {
  return {
    name: 'palm-service',
    async configureServer(server) {
      const { mountPalmService } = await import('./server/palm-service.mjs')
      mountPalmService(server.middlewares)
    },
    async configurePreviewServer(server) {
      const { mountPalmService } = await import('./server/palm-service.mjs')
      mountPalmService(server.middlewares)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), palmService()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  test: {
    // The suite covers the OS core, which is deliberately free of DOM and
    // React dependencies — so it runs in plain Node, with no jsdom to set up.
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/apps/**/engine.ts', 'src/apps/**/parser.ts', 'src/utils/**'],
      reporter: ['text-summary'],
    },
  },
})
