import { Routes, Route, Navigate } from 'react-router-dom'
import PlayView from './routes/play'
import HostView from './routes/host'
import ProjectorView from './routes/projector'

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
      <Route path="/play" element={<PlayWithLandscapeGuard />} />
      <Route path="/host" element={<HostView />} />
      <Route path="/projector" element={<ProjectorView />} />
      <Route path="*" element={<Navigate to="/play" replace />} />
    </Routes>
  )
}
