import { Routes, Route, Navigate } from 'react-router-dom'
import PlayView from './routes/play'
import HostView from './routes/host'
import ProjectorView from './routes/projector'
import TapPreview from './routes/preview/TapPreview'
import ErrorBoundary from './components/ErrorBoundary'
import ConnectionBanner from './components/ConnectionBanner'

function PlayWithLandscapeGuard() {
  return (
    <>
      <PlayView />
      <div className="play-landscape-warning fixed inset-0 flex-col items-center justify-center text-center p-8 bg-gray-950 text-white" style={{ zIndex: 200 }}>
        <p className="text-5xl mb-4">📱</p>
        <p className="text-2xl font-black mb-2">Please rotate your phone</p>
        <p className="text-gray-400 text-sm">This game works best in portrait mode</p>
      </div>
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
