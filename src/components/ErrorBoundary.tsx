
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

// Catches any render crash so a bar full of players never sees a blank white
// screen mid-game. Session lives in localStorage, so a reload resumes the game.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
          <p className="text-6xl mb-6">🍺</p>
          <p className="text-2xl font-black text-yellow-400 mb-2">Spilled a little</p>
          <p className="text-gray-400 text-sm max-w-xs leading-relaxed mb-8">
            This screen hit a snag. Your team and score are safe — reload to jump back in.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-8 py-4 rounded-2xl text-lg font-black bg-yellow-400 text-gray-950"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
