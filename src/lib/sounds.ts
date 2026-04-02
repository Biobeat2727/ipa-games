// Web Audio API sound engine — zero audio files, all synthesised

let ctx: AudioContext | null = null

export function initAudio() {
  if (ctx) return
  try {
    ctx = new AudioContext()
  } catch {
    // AudioContext not available
  }
}

function getCtx(): AudioContext | null {
  if (!ctx) {
    try { ctx = new AudioContext() } catch { return null }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

// Helper: play a single tone with linear attack and exponential release
function tone(
  c: AudioContext,
  frequency: number,
  type: OscillatorType,
  startTime: number,
  duration: number,
  peakGain = 0.3,
  fadeIn = 0.01,
) {
  const osc  = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(frequency, startTime)
  gain.gain.setValueAtTime(0, startTime)
  gain.gain.linearRampToValueAtTime(peakGain, startTime + fadeIn)
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.01)
}

// ── Public API ────────────────────────────────────────────────

export function playBuzz() {
  const c = getCtx(); if (!c) return
  const t = c.currentTime
  tone(c, 880, 'sine', t, 0.12, 0.45, 0.005)
  tone(c, 1320, 'sine', t + 0.06, 0.08, 0.2, 0.005)
}

export function playCorrect() {
  const c = getCtx(); if (!c) return
  const t = c.currentTime
  tone(c, 523, 'sine', t, 0.15, 0.35)
  tone(c, 659, 'sine', t + 0.13, 0.15, 0.35)
  tone(c, 784, 'sine', t + 0.26, 0.35, 0.45)
  tone(c, 1046, 'sine', t + 0.39, 0.4, 0.5)
}

export function playWrong() {
  const c = getCtx(); if (!c) return
  const t = c.currentTime
  tone(c, 280, 'sawtooth', t, 0.1, 0.45, 0.005)
  tone(c, 200, 'sawtooth', t + 0.09, 0.2, 0.45, 0.005)
  tone(c, 140, 'sawtooth', t + 0.2, 0.2, 0.4, 0.01)
}

export function playTick() {
  const c = getCtx(); if (!c) return
  const t = c.currentTime
  tone(c, 1200, 'square', t, 0.04, 0.08, 0.002)
}

export function playScoreUp() {
  const c = getCtx(); if (!c) return
  const t = c.currentTime
  tone(c, 523, 'sine', t, 0.07, 0.28, 0.005)
  tone(c, 784, 'sine', t + 0.06, 0.09, 0.35, 0.005)
  tone(c, 1046, 'sine', t + 0.14, 0.28, 0.35, 0.01)
}

export function playScoreDown() {
  const c = getCtx(); if (!c) return
  const t = c.currentTime
  tone(c, 440, 'sine', t, 0.12, 0.3, 0.005)
  tone(c, 330, 'sine', t + 0.1, 0.18, 0.3, 0.005)
}

export function playDoubleTap() {
  const c = getCtx(); if (!c) return
  const t = c.currentTime
  // Low boom
  tone(c, 60, 'sawtooth', t, 0.4, 0.55, 0.01)
  // Rising fanfare
  tone(c, 220, 'square', t + 0.05, 0.18, 0.3, 0.01)
  tone(c, 440, 'sine', t + 0.22, 0.18, 0.42, 0.01)
  tone(c, 660, 'sine', t + 0.38, 0.2, 0.42, 0.01)
  tone(c, 880, 'sine', t + 0.52, 0.45, 0.48, 0.01)
  tone(c, 1108, 'sine', t + 0.68, 0.55, 0.55, 0.02)
}

export function playRoundTransition() {
  const c = getCtx(); if (!c) return
  const t = c.currentTime
  const freqs = [261, 329, 392, 523, 659, 784, 1046]
  freqs.forEach((f, i) => {
    tone(c, f, 'sine', t + i * 0.09, 0.45, 0.35, 0.01)
  })
  // Sustain the chord
  tone(c, 523, 'sine', t + 0.65, 0.7, 0.38, 0.02)
  tone(c, 659, 'sine', t + 0.65, 0.7, 0.32, 0.02)
  tone(c, 784, 'sine', t + 0.65, 0.7, 0.28, 0.02)
}

// ── Final Jeopardy looping music ──────────────────────────────

let fjRunning    = false
let fjNextTime   = 0
let fjScheduleId = 0

const FJ_NOTES   = [110, 123, 130, 146, 164, 146, 130, 123] // A2 minor arp
const FJ_NOTE_LEN = 0.42

function scheduleFJBatch(c: AudioContext, batchStart: number) {
  if (!fjRunning) return
  for (let i = 0; i < FJ_NOTES.length; i++) {
    const t = batchStart + i * FJ_NOTE_LEN
    // Bass note every 2 beats
    if (i % 2 === 0) tone(c, FJ_NOTES[i] / 2, 'triangle', t, FJ_NOTE_LEN * 1.8, 0.1, 0.02)
    // Melody
    tone(c, FJ_NOTES[i], 'triangle', t, FJ_NOTE_LEN * 0.85, 0.12, 0.01)
    // Harmony a fifth up
    if (i % 4 === 0) tone(c, FJ_NOTES[i] * 1.5, 'sine', t, FJ_NOTE_LEN * 1.2, 0.05, 0.02)
  }
  const batchDuration = FJ_NOTES.length * FJ_NOTE_LEN
  fjNextTime = batchStart + batchDuration
  // Schedule next batch ~200ms before current one ends
  fjScheduleId = window.setTimeout(
    () => scheduleFJBatch(c, fjNextTime),
    Math.max(0, (fjNextTime - c.currentTime - 0.2) * 1000)
  )
}

export function playFinalJeopardyMusic(stop = false) {
  if (stop) {
    fjRunning = false
    clearTimeout(fjScheduleId)
    return
  }
  if (fjRunning) return
  const c = getCtx(); if (!c) return
  fjRunning = true
  scheduleFJBatch(c, c.currentTime)
}
