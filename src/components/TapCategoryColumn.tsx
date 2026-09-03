import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react'

type GlassState = 'full' | 'draining' | 'empty'

const GLASS_PATH = 'M 8 6 L 13 92 Q 35 98 57 92 L 62 6 Z'

export function BeerGlass({
  pointValue,
  state,
  onClick,
  disabled = false,
  dimmed = false,
  fit = false,
}: {
  pointValue: number
  state: GlassState
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  dimmed?: boolean
  /** Keep the glass's real proportions and bottom-align it in the cell
   *  (projector: wide short cells would otherwise squash the glass).
   *  Default stretches to fill — the phone board's cells are cut for that. */
  fit?: boolean
}) {
  const fillPct  = state === 'empty' ? 0 : state === 'draining' ? 45 : 86
  const fillY    = 98 - (fillPct / 100) * 88
  const fillH    = (fillPct / 100) * 88
  const isDisabled = disabled || state === 'empty'

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={`relative w-full h-full flex items-center justify-center transition-[filter,opacity] disabled:cursor-default ${
        dimmed ? 'opacity-60 grayscale-[35%]' : !isDisabled ? 'hover:brightness-110 active:brightness-95' : ''
      }`}
    >
      <svg viewBox="0 0 70 104" preserveAspectRatio={fit ? 'xMidYMax meet' : 'none'} className="w-full h-full" style={{ filter: 'drop-shadow(0 3px 3px rgba(0,0,0,0.45))' }}>
        <defs>
          <clipPath id={`glass-clip-${pointValue}`}>
            <path d={GLASS_PATH} />
          </clipPath>
          <linearGradient id={`beer-${pointValue}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#fcd34d" />
            <stop offset="45%"  stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#c2650a" />
          </linearGradient>
          <linearGradient id={`glass-body-${pointValue}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="rgba(255,255,255,0.14)" />
            <stop offset="18%"  stopColor="rgba(255,255,255,0.02)" />
            <stop offset="82%"  stopColor="rgba(255,255,255,0.02)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.14)" />
          </linearGradient>
          <radialGradient id={`shadow-${pointValue}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(0,0,0,0.5)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
          <linearGradient id={`foam-${pointValue}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#ffffff" />
            <stop offset="100%" stopColor="#f3e3bd" />
          </linearGradient>
        </defs>

        {/* grounding shadow */}
        <ellipse cx="35" cy="100" rx="24" ry="3.5" fill={`url(#shadow-${pointValue})`} />

        {/* glass body */}
        <path d={GLASS_PATH} fill={`url(#glass-body-${pointValue})`} stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />

        {/* beer fill + foam, clipped to glass shape */}
        <g clipPath={`url(#glass-clip-${pointValue})`}>
          <rect
            x="0" y={fillY} width="70" height={fillH}
            fill={`url(#beer-${pointValue})`}
            style={{ transition: 'y 900ms ease-in, height 900ms ease-in' }}
          />
          {/* carbonation streaks */}
          {fillPct > 0 && (
            <rect x="24" y={fillY + 2} width="1.4" height={Math.max(fillH - 6, 0)} fill="rgba(255,255,255,0.22)"
              style={{ transition: 'y 900ms ease-in, height 900ms ease-in' }} />
          )}
          {fillPct > 0 && (
            <rect x="43" y={fillY + 2} width="1.1" height={Math.max(fillH - 14, 0)} fill="rgba(255,255,255,0.16)"
              style={{ transition: 'y 900ms ease-in, height 900ms ease-in' }} />
          )}
          {/* foam head — one continuous frothy mass, not floating orbs */}
          {fillPct > 0 && (
            <g style={{ transition: 'transform 900ms ease-in' }} transform={`translate(0, ${fillY - 9})`}>
              <path
                d="M 0 6 C 3 1 7 0 10 3 C 13 6 16 1 20 1 C 24 1 26 6 30 5 C 34 4 35 0 39 1 C 43 2 44 6 48 5 C 52 4 53 0 57 1 C 61 2 63 6 66 4 C 68 3 69 2 70 3 L 70 13 L 0 13 Z"
                fill={`url(#foam-${pointValue})`}
              />
              {/* subtle bubble texture within the foam body, not sitting proud of it */}
              <circle cx="10" cy="7" r="0.9" fill="rgba(255,255,255,0.7)" />
              <circle cx="19" cy="9" r="0.7" fill="rgba(210,170,90,0.35)" />
              <circle cx="29" cy="7" r="0.8" fill="rgba(255,255,255,0.6)" />
              <circle cx="38" cy="9.5" r="0.6" fill="rgba(210,170,90,0.3)" />
              <circle cx="48" cy="7.5" r="0.9" fill="rgba(255,255,255,0.65)" />
              <circle cx="58" cy="9" r="0.7" fill="rgba(210,170,90,0.3)" />
              {/* faint edge where foam meets beer, for separation */}
              <rect x="0" y="12" width="70" height="1.5" fill="rgba(180,120,20,0.3)" />
            </g>
          )}
          {/* rising bubbles */}
          {fillPct > 0 && (
            <>
              <circle cx="26" cy="75" r="1.3" fill="#fef3c7" opacity="0.55">
                <animate attributeName="cy" values="90;15" dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.55;0" dur="2.4s" repeatCount="indefinite" />
              </circle>
              <circle cx="42" cy="82" r="1" fill="#fef3c7" opacity="0.45">
                <animate attributeName="cy" values="92;20" dur="1.9s" begin="0.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.45;0" dur="1.9s" begin="0.5s" repeatCount="indefinite" />
              </circle>
            </>
          )}
        </g>

        {/* glass rim */}
        <ellipse cx="35" cy="6" rx="27" ry="2.4" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />

        {/* glass shine */}
        <path d="M 16 11 L 19 84" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>

      {state !== 'empty' && (
        <span
          className="absolute font-black text-amber-950 font-mono tabular-nums"
          style={{
            fontSize: 'clamp(1.15rem, 5.5vw, 2.15rem)',
            top: '42%',
            transform: 'translateY(-50%)',
            textShadow: '0 1px 0 rgba(255,255,255,0.35)',
          }}
        >
          {pointValue}
        </span>
      )}
    </button>
  )
}

/** Round-start category intro: 'hidden' shows a blank sign with a ?, 'revealing'
 *  plays the pop-in animation once, 'shown' (default) is the normal header. */
export type TapHeaderReveal = 'hidden' | 'revealing' | 'shown'

/** Maps the broadcast reveal state (ids revealed so far, in reveal order) to one
 *  header's TapHeaderReveal. Shared by player + projector so the two screens can
 *  never disagree on which sign is hidden or animating. null = reveal inactive. */
export function tapHeaderRevealFor(revealedIds: string[] | null, catId: string): TapHeaderReveal {
  if (revealedIds == null) return 'shown'
  if (!revealedIds.includes(catId)) return 'hidden'
  return catId === revealedIds[revealedIds.length - 1] ? 'revealing' : 'shown'
}

// ── Sign text fitting ────────────────────────────────────────
// A phone column fits only ~6 uppercase characters per line. Multi-word names
// wrap between words on their own; a single long word ("Conspiracies") had no
// break point and was clipped. Automatic hyphenation isn't deterministic across
// phones (it needs a dictionary the device may not have), so instead:
//   1. measure the longest word and shrink the sign's font just enough for it
//      to fit on one line, down to SIGN_MIN_FONT_SCALE;
//   2. if it still can't fit, break at a soft hyphen placed mid-word
//      ("Conspi-racies"), never one character from the end ("Sequel-s").
// Measured on a 375px phone with five columns: ~46px per sign, ~7.3px per
// uppercase character at the base size. 0.72 lets an 8-letter word ("Unsolved",
// "Medicine") stay on one line; anything longer breaks at its soft hyphen.
const SIGN_BASE_FONT = 'clamp(0.7rem, 1.7vw, 1.3rem)'
const SIGN_MIN_FONT_SCALE = 0.7
const SOFT_HYPHEN_MIN_WORD = 9
// Scaled text lands within a pixel of the column and sub-pixel rounding can
// still tip it over — always aim a little under the available width.
const SIGN_FIT_MARGIN = 0.95

function longestWord(name: string): string {
  return name.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), '')
}
function softHyphenate(name: string): string {
  return name.split(' ').map(w => {
    if (w.length < SOFT_HYPHEN_MIN_WORD) return w
    const cut = Math.ceil(w.length / 2)
    return w.slice(0, cut) + '­' + w.slice(cut)
  }).join(' ')
}

export function TapHeader({ categoryName, reveal = 'shown' }: { categoryName: string; reveal?: TapHeaderReveal }) {
  const hidden = reveal === 'hidden'
  const textRef  = useRef<HTMLParagraphElement>(null)
  const probeRef = useRef<HTMLSpanElement>(null)
  const [fontScale, setFontScale] = useState(1)

  useLayoutEffect(() => {
    const text = textRef.current
    const probe = probeRef.current
    if (!text || !probe) return
    const fit = () => {
      const avail = text.clientWidth
      const need  = probe.offsetWidth
      if (avail <= 0 || need <= 0) return
      const ratio = (avail * SIGN_FIT_MARGIN) / need
      if (ratio >= 1) { setFontScale(1); return }
      const word = longestWord(categoryName)
      if (ratio >= SIGN_MIN_FONT_SCALE || word.length < SOFT_HYPHEN_MIN_WORD) {
        setFontScale(Math.max(SIGN_MIN_FONT_SCALE, ratio))
        return
      }
      // It will break at the soft hyphen either way, so size for the longer
      // half (plus the hyphen) instead of shrinking the whole word to the floor.
      const cut = Math.ceil(word.length / 2)
      const halfNeed = need * (Math.max(cut, word.length - cut) + 1) / word.length
      setFontScale(Math.min(1, Math.max(SIGN_MIN_FONT_SCALE, (avail * SIGN_FIT_MARGIN) / halfNeed)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(text)
    // Web font arriving after first paint changes the measurement
    document.fonts?.ready.then(fit).catch(() => {})
    return () => ro.disconnect()
  }, [categoryName])

  return (
    <div className="flex flex-col items-center">
      {/* knob */}
      <div
        className="w-4 h-4 rounded-full shrink-0 mb-[-2px] z-10"
        style={{
          background: 'radial-gradient(circle at 35% 30%, #f5e6c8, #b8863b 55%, #6b4a1f 100%)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.5)',
        }}
      />
      {/* neck */}
      <div className="w-1.5 h-2 bg-gradient-to-b from-neutral-400 to-neutral-600 shrink-0" />

      <div
        className="relative w-full text-center rounded-lg px-2 py-3"
        style={{
          background: 'linear-gradient(180deg, #92400e 0%, #78350f 55%, #451a03 100%)',
          border: '1px solid rgba(0,0,0,0.4)',
          boxShadow: '0 2px 0 rgba(255,255,255,0.08) inset, 0 3px 6px rgba(0,0,0,0.4)',
          // The revealing sign pops over its neighbors; overflow stays visible
          // for the scaled-up frame, and z-index lifts it above the board.
          overflow: reveal === 'revealing' ? 'visible' : 'hidden',
          zIndex: reveal === 'revealing' ? 30 : undefined,
          animation: reveal === 'revealing' ? 'cat-reveal-pop 1s cubic-bezier(0.34, 1.4, 0.5, 1) both' : undefined,
        }}
      >
        <div className="absolute inset-x-0 top-0 h-[3px] bg-white/10" />
        {/* The real name always occupies the layout (invisible while hidden) so
            the header row doesn't jump taller when a two-line name reveals */}
        <p
          ref={textRef}
          className="relative font-black uppercase leading-tight text-amber-50"
          style={{
            fontSize: fontScale === 1 ? SIGN_BASE_FONT : `calc(${SIGN_BASE_FONT} * ${fontScale.toFixed(3)})`,
            letterSpacing: '0.02em',
            textShadow: '0 1px 1px rgba(0,0,0,0.5)',
            opacity: hidden ? 0 : 1,
            // Last resort only — the soft hyphen is the intended break point
            overflowWrap: 'anywhere',
          }}
        >
          {softHyphenate(categoryName)}
          {/* Unscaled, single-line copy of the longest word: what "fits" is measured against */}
          <span
            ref={probeRef}
            aria-hidden
            style={{ position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none', fontSize: SIGN_BASE_FONT, left: 0, top: 0 }}
          >
            {longestWord(categoryName)}
          </span>
        </p>
        {hidden && (
          <span
            className="absolute inset-0 flex items-center justify-center font-black"
            style={{ fontSize: 'clamp(0.9rem, 2vw, 1.5rem)', color: 'rgba(253, 230, 138, 0.35)' }}
          >
            ?
          </span>
        )}
      </div>
    </div>
  )
}

export default function TapCategoryColumn({ categoryName, pointValues }: { categoryName: string; pointValues: number[] }) {
  const [states, setStates] = useState<GlassState[]>(pointValues.map(() => 'full'))

  const handlePour = (idx: number) => {
    if (states[idx] !== 'full') return
    setStates(prev => prev.map((s, i) => (i === idx ? 'draining' : s)))
    setTimeout(() => {
      setStates(prev => prev.map((s, i) => (i === idx ? 'empty' : s)))
    }, 900)
  }

  return (
    <div className="flex flex-col gap-2 h-full">
      <TapHeader categoryName={categoryName} />
      <div className="flex-1 min-h-0 grid gap-2" style={{ gridTemplateRows: `repeat(${pointValues.length}, minmax(0, 1fr))` }}>
        {pointValues.map((pv, idx) => (
          <BeerGlass key={pv} pointValue={pv} state={states[idx]} onClick={() => handlePour(idx)} />
        ))}
      </div>
    </div>
  )
}
