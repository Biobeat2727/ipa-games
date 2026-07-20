
import { useEffect, useRef, useState } from 'react'
import { ablyClient } from '../lib/ably'

type BannerState = 'ok' | 'reconnecting' | 'restored'

// Slim status strip pinned to the top of the screen. On bar wifi, players WILL
// drop — without this they silently miss questions and blame the game. The
// layered polling fallbacks recover the state; this tells the player (and the
// host looking over shoulders) that recovery is happening.
export default function ConnectionBanner() {
  const [state, setState] = useState<BannerState>('ok')
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onDown = () => {
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current)
      setState('reconnecting')
    }
    const onUp = () => {
      // Only flash "back online" if we actually showed the reconnecting state —
      // 'connected' also fires on the very first connect.
      setState(prev => {
        if (prev !== 'reconnecting') return prev
        restoreTimerRef.current = setTimeout(() => setState('ok'), 2500)
        return 'restored'
      })
    }
    ablyClient.connection.on('disconnected', onDown)
    ablyClient.connection.on('suspended', onDown)
    ablyClient.connection.on('connected', onUp)
    return () => {
      ablyClient.connection.off('disconnected', onDown)
      ablyClient.connection.off('suspended', onDown)
      ablyClient.connection.off('connected', onUp)
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current)
    }
  }, [])

  if (state === 'ok') return null

  return (
    <div
      className={`fixed top-0 inset-x-0 z-[300] flex items-center justify-center gap-2 py-1.5 px-4 text-xs font-bold text-gray-950 ${
        state === 'reconnecting' ? 'bg-amber-400' : 'bg-green-400'
      }`}
      style={{ animation: 'banner-drop 0.3s ease-out both' }}
    >
      {state === 'reconnecting' ? (
        <>
          <span className="w-3 h-3 rounded-full border-2 border-gray-950 border-t-transparent animate-spin" />
          Reconnecting to the game…
        </>
      ) : (
        <>✓ Back online</>
      )}
    </div>
  )
}
