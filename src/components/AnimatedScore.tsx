import { useEffect, useRef, useState } from 'react'

interface Props {
  value: number
  className?: string
  style?: React.CSSProperties
  duration?: number
  onComplete?: () => void
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export default function AnimatedScore({ value, className, style, duration = 600, onComplete }: Props) {
  const [displayed, setDisplayed] = useState(value)
  const prevRef  = useRef(value)
  const rafRef   = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    const from = prevRef.current
    const to   = value
    if (from === to) return

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    startRef.current = null

    const animate = (timestamp: number) => {
      if (!startRef.current) startRef.current = timestamp
      const elapsed  = timestamp - startRef.current
      const progress = Math.min(elapsed / duration, 1)
      const eased    = easeOut(progress)
      setDisplayed(Math.round(from + (to - from) * eased))
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        prevRef.current = to
        rafRef.current  = null
        onComplete?.()
      }
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [value, duration, onComplete])

  return <span className={className} style={style}>{displayed}</span>
}
