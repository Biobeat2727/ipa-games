import { useEffect, useRef } from 'react'

interface Piece {
  x: number; y: number
  vx: number; vy: number
  rotation: number; rotSpeed: number
  color: string
  w: number; h: number
  alpha: number
}

const COLORS = ['#facc15', '#22c55e', '#3b82f6', '#ef4444', '#a855f7', '#f97316', '#06b6d4', '#f43f5e']

function rnd(a: number, b: number) { return a + Math.random() * (b - a) }

interface Props {
  active: boolean
  onDone?: () => void
}

export default function Confetti({ active, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number | null>(null)
  const piecesRef = useRef<Piece[]>([])

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight

    // Burst from upper-center
    piecesRef.current = Array.from({ length: 140 }, () => ({
      x: canvas.width / 2 + rnd(-80, 80),
      y: canvas.height * 0.3,
      vx: rnd(-14, 14),
      vy: rnd(-20, -5),
      rotation: rnd(0, Math.PI * 2),
      rotSpeed: rnd(-0.18, 0.18),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      w: rnd(8, 16),
      h: rnd(4, 9),
      alpha: 1,
    }))

    let last = performance.now()

    function tick(now: number) {
      const dt = Math.min((now - last) / 16.67, 3)
      last = now
      ctx2d!.clearRect(0, 0, canvas!.width, canvas!.height)

      let anyAlive = false
      for (const p of piecesRef.current) {
        p.vy += 0.45 * dt
        p.vx *= Math.pow(0.992, dt)
        p.x  += p.vx * dt
        p.y  += p.vy * dt
        p.rotation += p.rotSpeed * dt
        if (p.y > canvas!.height * 0.65) p.alpha = Math.max(0, p.alpha - 0.025 * dt)
        if (p.alpha <= 0) continue
        anyAlive = true
        ctx2d!.save()
        ctx2d!.translate(p.x, p.y)
        ctx2d!.rotate(p.rotation)
        ctx2d!.globalAlpha = p.alpha
        ctx2d!.fillStyle   = p.color
        ctx2d!.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx2d!.restore()
      }

      if (anyAlive) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        onDone?.()
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [active, onDone])

  if (!active) return null

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 60 }}
    />
  )
}
