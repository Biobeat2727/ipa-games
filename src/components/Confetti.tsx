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
  const onDoneRef = useRef(onDone)

  // Keep ref current without adding onDone to effect deps
  useEffect(() => { onDoneRef.current = onDone }, [onDone])

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight

    const W = canvas.width
    const H = canvas.height

    // 70 pieces per corner — bottom-left shoots up+right, bottom-right shoots up+left
    const makeCorner = (fromX: number, dirX: 1 | -1): Piece[] =>
      Array.from({ length: 70 }, () => ({
        x: fromX + rnd(-20, 20),
        y: H - rnd(0, 20),
        vx: dirX * rnd(3, 14),
        vy: rnd(-22, -10),
        rotation: rnd(0, Math.PI * 2),
        rotSpeed: rnd(-0.2, 0.2),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        w: rnd(8, 16),
        h: rnd(4, 9),
        alpha: 1,
      }))

    piecesRef.current = [
      ...makeCorner(0, 1),        // bottom-left
      ...makeCorner(W, -1),       // bottom-right
    ]

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
        // Fade out as pieces fall back toward the bottom half
        if (p.y > canvas!.height * 0.6) p.alpha = Math.max(0, p.alpha - 0.03 * dt)
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
        onDoneRef.current?.()
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [active]) // onDone intentionally excluded — tracked via ref

  if (!active) return null

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 60 }}
    />
  )
}
