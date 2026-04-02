import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { initAudio } from './lib/sounds'

// Unlock Web Audio API on first user gesture (required by all browsers)
const unlockAudio = () => { initAudio(); document.removeEventListener('click', unlockAudio); document.removeEventListener('touchstart', unlockAudio) }
document.addEventListener('click', unlockAudio)
document.addEventListener('touchstart', unlockAudio)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
