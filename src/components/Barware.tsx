import { useId, useMemo, type CSSProperties } from 'react'

// Shared decorative pieces for the bar atmosphere: an animated pint glass hero
// and a field of slow-rising ambient bubbles. Pure CSS/SVG — nothing here is
// interactive and everything collapses under prefers-reduced-motion.

const GLASS_PATH = 'M 8 6 L 13 92 Q 35 98 57 92 L 62 6 Z'

export function PintHero({ className = 'w-20 h-32' }: { className?: string }) {
  const uid = useId()
  return (
    <div className={`relative ${className}`} style={{ animation: 'hero-float 3.5s ease-in-out infinite' }}>
      {/* Static amber glow behind the glass. Was a 20px drop-shadow filter on the
          SVG, which had to be re-blurred every frame the bubbles moved. */}
      <div aria-hidden className="absolute pointer-events-none"
        style={{ inset: '8% -18% -6%', background: 'radial-gradient(closest-side, rgba(245,158,11,0.28), rgba(245,158,11,0) 100%)' }} />
      <svg
        viewBox="0 0 70 104"
        className="relative w-full h-full"
      >
        <defs>
          <clipPath id={`hero-clip-${uid}`}>
            <path d={GLASS_PATH} />
          </clipPath>
          <linearGradient id={`hero-beer-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#fcd34d" />
            <stop offset="45%"  stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#c2650a" />
          </linearGradient>
          <linearGradient id={`hero-glass-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="rgba(255,255,255,0.14)" />
            <stop offset="18%"  stopColor="rgba(255,255,255,0.02)" />
            <stop offset="82%"  stopColor="rgba(255,255,255,0.02)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.14)" />
          </linearGradient>
          <linearGradient id={`hero-foam-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#ffffff" />
            <stop offset="100%" stopColor="#f3e3bd" />
          </linearGradient>
        </defs>

        <path
          d={GLASS_PATH}
          fill={`url(#hero-glass-${uid})`}
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />

        <g clipPath={`url(#hero-clip-${uid})`}>
          {/* beer + foam pour up together on mount */}
          <g style={{ animation: 'pour-rise 1.2s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both' }}>
            <rect x="0" y="22" width="70" height="82" fill={`url(#hero-beer-${uid})`} />
            <g transform="translate(0, 13)">
              <path
                d="M 0 6 C 3 1 7 0 10 3 C 13 6 16 1 20 1 C 24 1 26 6 30 5 C 34 4 35 0 39 1 C 43 2 44 6 48 5 C 52 4 53 0 57 1 C 61 2 63 6 66 4 C 68 3 69 2 70 3 L 70 13 L 0 13 Z"
                fill={`url(#hero-foam-${uid})`}
              />
              <circle cx="10" cy="7" r="0.9" fill="rgba(255,255,255,0.7)" />
              <circle cx="29" cy="7" r="0.8" fill="rgba(255,255,255,0.6)" />
              <circle cx="48" cy="7.5" r="0.9" fill="rgba(255,255,255,0.65)" />
              <rect x="0" y="12" width="70" height="1.5" fill="rgba(180,120,20,0.3)" />
            </g>
            <rect x="24" y="26" width="1.4" height="64" fill="rgba(255,255,255,0.22)" />
            <rect x="43" y="30" width="1.1" height="56" fill="rgba(255,255,255,0.16)" />
          </g>
        </g>

        <ellipse cx="35" cy="6" rx="27" ry="2.4" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path d="M 16 11 L 19 84" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* Rising bubbles — compositor-only (see .glass-bubble in index.css) */}
      <span aria-hidden className="glass-bubbles absolute pointer-events-none" style={{ left: '30%', right: '30%', top: '30%', bottom: '8%' }}>
        <span className="glass-bubble" style={{ left: '8%', animationDuration: '2.4s' }} />
        <span className="glass-bubble" style={{ left: '62%', animationDuration: '1.9s', animationDelay: '-0.6s', ['--bubble-size' as string]: '3px' }} />
        <span className="glass-bubble" style={{ left: '38%', animationDuration: '2.8s', animationDelay: '-1.5s', ['--bubble-size' as string]: '2.5px' }} />
      </span>
    </div>
  )
}

// Small glass icons for the Team-or-Solo choice. Same silhouette DNA as
// PintHero (tapered glass, foam head, vertical highlight) but stripped of the
// fine detail, which turns to mush at icon size. Colours are passed in so the
// two choices can read as two different pours.
const ICON_GLASS = 'M 7 6 L 11 44 Q 24 49 37 44 L 41 6 Z'

function Glass({ uid, from, to }: { uid: string; from: string; to: string }) {
  return (
    <>
      <defs>
        <clipPath id={`g-clip-${uid}`}><path d={ICON_GLASS} /></clipPath>
        <linearGradient id={`g-beer-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      <path d={ICON_GLASS} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.45)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <g clipPath={`url(#g-clip-${uid})`}>
        <rect x="0" y="14" width="48" height="40" fill={`url(#g-beer-${uid})`} />
        <rect x="0" y="11" width="48" height="4.5" fill="#fff8e7" />
        <rect x="16" y="17" width="1.6" height="28" fill="rgba(255,255,255,0.25)" />
      </g>
      <ellipse cx="24" cy="6" rx="17" ry="1.8" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </>
  )
}

export function SoloPint({ className = 'w-12 h-14', from = '#fcd34d', to = '#c2650a' }:
  { className?: string; from?: string; to?: string }) {
  const uid = useId()
  return (
    <svg viewBox="0 0 48 52" className={className} aria-hidden>
      <Glass uid={uid} from={from} to={to} />
    </svg>
  )
}

export function CheersPints({ className = 'w-12 h-14', from = '#fcd34d', to = '#c2650a' }:
  { className?: string; from?: string; to?: string }) {
  const a = useId()
  const b = useId()
  return (
    <svg viewBox="0 0 84 52" className={className} aria-hidden>
      {/* tilted toward each other so they read as a clink, not two parked glasses */}
      <g transform="translate(2 3) rotate(-11 24 26)"><Glass uid={a} from={from} to={to} /></g>
      <g transform="translate(34 3) rotate(11 24 26)"><Glass uid={b} from={from} to={to} /></g>
    </svg>
  )
}

export function Bubbles({ count = 14 }: { count?: number }) {
  const bubbles = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: Math.random() * 100,
        size: 3 + Math.random() * 6,
        duration: 7 + Math.random() * 9,
        delay: Math.random() * 10,
        drift: (Math.random() - 0.5) * 48,
      })),
    [count],
  )
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      {bubbles.map((b, i) => (
        <span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${b.left}%`,
            bottom: -12,
            width: b.size,
            height: b.size,
            background: 'radial-gradient(circle at 35% 30%, rgba(253,230,138,0.9), rgba(245,158,11,0.35))',
            '--drift': `${b.drift}px`,
            animation: `bubble-rise ${b.duration}s linear ${-b.delay}s infinite`,
          } as CSSProperties}
        />
      ))}
    </div>
  )
}
