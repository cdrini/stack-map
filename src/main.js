import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import './style.css'
import ui from '@nuxt/ui/vue-plugin'
import App from './App.vue'
import { loadSpec } from './spec.js'

// No actual routes — this is a single-page app — but <UApp> (Nuxt UI's
// root provider) calls useRoute() internally, which throws unless some
// router is installed, even an empty one.
const router = createRouter({ routes: [], history: createWebHistory() })

loadSpec()
  .then(() => createApp(App).use(router).use(ui).mount('#app'))
  .catch((err) => {
    document.getElementById('app').textContent = `Failed to load stack spec: ${err.message}`
  })
