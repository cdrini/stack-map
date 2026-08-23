import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    ui({
      // Nuxt UI defaults to following the OS/browser's dark/light
      // preference (colorMode: true) — this app only has a light design
      // (see style.css's `color-scheme: light`), so that's disabled rather
      // than having its controls flip to dark-mode colors against our
      // light backgrounds.
      colorMode: false,
      ui: {
        colors: {
          // Default primary is green; 'stormy' is a custom muted
          // blue-gray defined via `@theme static` in style.css — stock
          // Tailwind blue/sky read as too bright/saturated next to the
          // map's own muted palette. `neutral` is left at its own default
          // ("slate"), which the map's grays already are.
          primary: 'stormy',
        },
      },
    }),
  ],
  optimizeDeps: {
    // @nuxt/ui's own Vite plugin excludes *itself* from pre-bundling (it
    // needs Vite's normal transform pipeline to resolve its `#imports`
    // virtual modules), but reka-ui — the headless-primitives library it's
    // built on — ships as hundreds of tiny individual files and doesn't
    // get swept into pre-bundling automatically as a result, since Vite's
    // dependency scanner never sees a plain static `import` of it to
    // discover. Explicitly including it here is what actually fixes the
    // multi-second dev-server cold start (500+ unbundled requests down to
    // one pre-bundled chunk) — this has no effect on the production build,
    // which already bundles everything via Rollup regardless.
    include: ['reka-ui'],
  },
  server: {
    // Dev runs the frontend (this server) and the FastAPI backend as two
    // separate processes on different ports — proxying /api here lets the
    // browser fetch it same-origin (see apiBase.js) instead of needing a
    // hardcoded backend hostname, which broke in Chrome depending on
    // whether it resolved "localhost" to ::1 or 127.0.0.1.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
