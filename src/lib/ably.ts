import Ably from 'ably'

export const ablyClient = new Ably.Realtime({
  key: import.meta.env.VITE_ABLY_KEY,
  clientId: crypto.randomUUID(),
})

// ── Server-clock sync ──────────────────────────────────────────────
// Device OS clocks can disagree by 100-200ms+ (measured on real devices), which
// breaks anything scheduled against a shared wall-clock timestamp — each device
// fires when ITS clock reaches the target. So we measure this device's offset
// from Ably's server clock (simplified NTP: take a few samples, trust the one
// with the smallest round-trip) and use serverNow() as the shared time base.
//
// If sync fails (offline, request error), offset stays at its last value
// (initially 0 = trust the local clock), so behavior degrades gracefully to
// pre-sync behavior rather than breaking.

let clockOffsetMs = 0

async function sampleOffset(): Promise<{ offset: number; rtt: number } | null> {
  const t0 = Date.now()
  try {
    const serverTime = await ablyClient.time()
    const t1 = Date.now()
    // Assume the server read the clock halfway through the round-trip.
    return { offset: serverTime - (t0 + (t1 - t0) / 2), rtt: t1 - t0 }
  } catch {
    return null
  }
}

export async function syncServerClock(): Promise<void> {
  const samples: Array<{ offset: number; rtt: number }> = []
  // Sequential (not parallel) so the requests don't contend and inflate RTT.
  for (let i = 0; i < 3; i++) {
    const s = await sampleOffset()
    if (s) samples.push(s)
  }
  if (samples.length === 0) return
  const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a))
  clockOffsetMs = best.offset
}

/** Shared time base for cross-device scheduling. Use instead of Date.now()
 *  whenever a timestamp travels between devices. */
export function serverNow(): number {
  return Date.now() + clockOffsetMs
}

export function getClockOffsetMs(): number {
  return clockOffsetMs
}

// Re-measure on every (re)connect — covers initial load and wifi drops mid-game.
ablyClient.connection.on('connected', () => { void syncServerClock() })
