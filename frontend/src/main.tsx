import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const buildId = import.meta.env.VITE_BUILD_ID ?? 'dev'
    navigator.serviceWorker.register(`/sw.js?v=${buildId}`).catch(() => {})
  })
}
