import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

async function bootstrap() {
  if ('__TAURI_INTERNALS__' in window) {
    const { installTauriBridge } = await import('./lib/tauriBridge')
    await installTauriBridge()
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
