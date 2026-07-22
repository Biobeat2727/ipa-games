import { useId, useMemo, type CSSProperties } from 'react'

// Shared decorative pieces for the bar atmosphere: an animated pint glass hero
// and a field of slow-rising ambient bubbles. Pure CSS/SVG — nothing here is
// interactive and everything collapses under prefers-reduced-motion.

const GLASS_PATH = 'M 8 6 L 13 92 Q 35 98 57 92 L 62 6 Z'

export function PintHero({ className = 'w-20 h-32' }: { className?: string }) {
  const uid = useId()
  return (
    <div className={className} style={{ animation: 'hero-float 3.5s ease-in-out infinite' }}>
      <svg
        viewBox="0 0 70 104"
        className="w-full h-full"
        style={{ filter: 'drop-shadow(0 6px 20px rgba(245,158,11,0.3))' }}
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
          {/* rising bubbles */}
          <circle cx="26" cy="75" r="1.3" fill="#fef3c7" opacity="0.55">
            <animate attributeName="cy" values="90;28" dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.55;0" dur="2.4s" repeatCount="indefinite" />
          </circle>
          <circle cx="42" cy="82" r="1" fill="#fef3c7" opacity="0.45">
            <animate attributeName="cy" values="92;32" dur="1.9s" begin="0.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.45;0" dur="1.9s" begin="0.5s" repeatCount="indefinite" />
          </circle>
          <circle cx="34" cy="85" r="0.8" fill="#fef3c7" opacity="0.4">
            <animate attributeName="cy" values="94;30" dur="2.8s" begin="1.1s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.4;0" dur="2.8s" begin="1.1s" repeatCount="indefinite" />
          </circle>
        </g>

        <ellipse cx="35" cy="6" rx="27" ry="2.4" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path d="M 16 11 L 19 84" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
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
