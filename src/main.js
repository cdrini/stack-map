import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { loadSpec } from './spec.js'

loadSpec()
  .then(() => createApp(App).mount('#app'))
  .catch((err) => {
    document.getElementById('app').textContent = `Failed to load stack spec: ${err.message}`
  })
