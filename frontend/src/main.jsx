import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { applyStoredTheme } from './config/theme'
import './index.css'
import App from './App.jsx'

// Apply stored theme before first paint to avoid flash
applyStoredTheme()

// file:// (packaged Electron) has no server path; web and Electron+dev use BrowserRouter
const useHashRouter = typeof window !== 'undefined' && window.location.protocol === 'file:'
const Router = useHashRouter ? HashRouter : BrowserRouter

if (typeof window !== 'undefined' && window.akiraDesktop) {
  document.documentElement.classList.add('akira-desktop-overlay')
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
)
