import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import PlayView from './routes/play'
import HostView from './routes/host'
import ProjectorView from './routes/projector'
import TapPreview from './routes/preview/TapPreview'
import ErrorBoundary from './components/ErrorBoundary'
import ConnectionBanner from './components/ConnectionBanner'

// A phone held sideways. Reads the device's orientation, not the viewport's
// shape: with interactive-widget=resizes-content the on-screen keyboard shrinks
// the viewport until a portrait phone looks landscape to a CSS media query.
function isPhoneLandscape(): boolean {
  if (!window.matchMedia('(pointer: coarse)').matches) return false
  const type = screen.orientation?.type
  const landscape = type
    ? type.startsWith('landscape')
    : Math.abs(Number((window as { orientation?: number }).orientation ?? 0)) === 90
  return landscape && Math.min(screen.width, screen.height) <= 480
}

function usePhoneLandscape() {
  const [landscape, setLandscape] = useState(isPhoneLandscape)
  useEffect(() => {
    const update = () => setLandscape(isPhoneLandscape())
    screen.orientation?.addEventListener('change', update)
    window.addEventListener('orientationchange', update)
    window.addEventListener('resize', update)
    return () => {
      screen.orientation?.removeEventListener('change', update)
      window.removeEventListener('orientationchange', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return landscape
}

function PlayWithLandscapeGuard() {
  const landscape = usePhoneLandscape()
  return (
    <>
      <PlayView />
      {landscape && <div className="fixed inset-0 flex flex-col items-center justify-center text-center p-8 bg-gray-950 text-white" style={{ zIndex: 200 }}>
        <p className="text-5xl mb-4">📱</p>
        <p className="text-2xl font-black mb-2">Please rotate your phone</p>
        <p className="text-gray-400 text-sm">This game works best in portrait mode</p>
      </div>}
    </>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/play" element={
        <ErrorBoundary>
          <ConnectionBanner />
          <PlayWithLandscapeGuard />
        </ErrorBoundary>
      } />
      <Route path="/host" element={
        <ErrorBoundary>
          <ConnectionBanner />
          <HostView />
        </ErrorBoundary>
      } />
      <Route path="/projector" element={
        <ErrorBoundary>
          <ConnectionBanner />
          <ProjectorView />
        </ErrorBoundary>
      } />
      <Route path="/preview" element={<TapPreview />} />
      <Route path="*" element={<Navigate to="/play" replace />} />
    </Routes>
  )
}
