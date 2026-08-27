import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Registra o service worker mínimo — necessário pra alguns navegadores
// tratarem o site como "app instalável de verdade" (ver public/sw.js).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Se falhar, o app continua funcionando normalmente — o service
      // worker aqui é só um reforço, não uma dependência.
    })
  })
}

// Pede ao navegador pra tratar o armazenamento deste site como persistente
// (menos sujeito a ser limpo sob pressão de espaço no aparelho). Nem todo
// navegador concede isso, e nenhum garante 100% — é best-effort.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {})
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
