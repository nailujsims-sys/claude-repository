import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { installPressFeedback } from './lib/pressFeedback'
import './index.css'

// One delegated listener drives the pressed state of every interactive surface
// in the app (see src/lib/pressFeedback.js). It is a document-level singleton
// for the app's whole lifetime, so it is installed here rather than in an
// effect — nothing re-runs it and nothing has to tear it down.
installPressFeedback()

// HashRouter keeps deep links working on GitHub Pages (no server rewrites).
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
