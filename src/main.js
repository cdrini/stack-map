import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import './style.css'
import ui from '@nuxt/ui/vue-plugin'
import App from './App.vue'
import { loadSpec, loadDefinitions } from './spec.js'

// No actual routes — this is a single-page app — but <UApp> (Nuxt UI's
// root provider) calls useRoute() internally, which throws unless some
// router is installed, even an empty one.
const router = createRouter({ routes: [], history: createWebHistory() })

// Only the spec itself gates the first render — it's the one request the map
// genuinely cannot be drawn without. Anything slower than a file read belongs
// after the mount, not in front of it (see loadDefinitions).
loadSpec()
  .then(() => {
    createApp(App).use(router).use(ui).mount('#app')
    loadDefinitions().catch((err) => {
      console.warn('stack-map: keeping the spec\'s own definition anchors:', err.message)
    })
  })
  .catch((err) => {
    document.getElementById('app').textContent = `Failed to load stack spec: ${err.message}`
  })
