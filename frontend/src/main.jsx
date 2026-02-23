import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { applyStoredTheme } from './config/theme'
import './index.css'
import App from './App.jsx'

// Apply stored theme before first paint to avoid flash
applyStoredTheme()

// In Electron (desktop) we load from file:// so use HashRouter; web uses BrowserRouter
const isDesktop = typeof window !== 'undefined' && window.__AKIRA_API__
const Router = isDesktop ? HashRouter : BrowserRouter

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
)
