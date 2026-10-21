import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startOfflineSync } from './lib/offline.ts'
import { purgeStaleClient } from './lib/staleClient.ts'

startOfflineSync()

if ('serviceWorker' in navigator) {
  let hadController = !!navigator.serviceWorker.controller
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true
      return
    }
    if (reloading) return
    reloading = true
    window.location.reload()
  })
  const update = () => {
    void navigator.serviceWorker.getRegistration().then((registration) => registration?.update())
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') update()
  })
  window.setInterval(update, 15_000)
  update()
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    void purgeStaleClient()
  })
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
