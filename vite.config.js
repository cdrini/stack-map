import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), ui()],
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
})
