import { Routes, Route, Navigate } from 'react-router-dom'
import PlayView from './routes/play'
import HostView from './routes/host'
import ProjectorView from './routes/projector'

export default function App() {
  return (
    <Routes>
      <Route path="/play" element={<PlayView />} />
      <Route path="/host" element={<HostView />} />
      <Route path="/projector" element={<ProjectorView />} />
      <Route path="*" element={<Navigate to="/play" replace />} />
    </Routes>
  )
}
