import { useEffect } from 'react'

/** Keep the phone screen awake while a game screen is mounted.
 *
 *  Beta-test finding: players with short screen timeouts had their phones lock
 *  mid-round and had to wake them before they could buzz. The Screen Wake Lock
 *  API (Android Chrome 84+, iOS Safari 16.4+) tells the OS not to dim or lock
 *  while the page is visible.
 *
 *  The lock is released automatically whenever the tab is hidden (app switch,
 *  screen lock, another tab), so it is re-requested every time the page becomes
 *  visible again. Some browsers refuse the request until the user has touched
 *  the page (and iOS refuses in Low Power Mode), so a failed request is retried
 *  on the next tap. Unsupported browsers are silently left alone. */
export function useWakeLock(enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let sentinel: WakeLockSentinel | null = null
    let requesting = false
    let disposed = false

    const request = async () => {
      if (disposed || requesting || sentinel) return
      if (document.visibilityState !== 'visible') return
      requesting = true
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (disposed) {
          lock.release().catch(() => {})
          return
        }
        sentinel = lock
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null
        })
      } catch {
        // Denied (Low Power Mode, no user gesture yet, insecure context) or
        // unsupported at runtime — retried on the next visibility change or tap.
      } finally {
        requesting = false
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void request()
    }
    const onInteract = () => {
      if (!sentinel) void request()
    }

    void request()
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('pointerdown', onInteract, { passive: true })
    document.addEventListener('keydown', onInteract, { passive: true })

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('pointerdown', onInteract)
      document.removeEventListener('keydown', onInteract)
      if (sentinel) {
        sentinel.release().catch(() => {})
        sentinel = null
      }
    }
  }, [enabled])
}
