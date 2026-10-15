import { useLayoutEffect, useRef } from 'react'

/** Clue card that sets its own font size: as large as fits the space it's given
 *  (up to `max`), never smaller than `min`. The answer screens hand it whatever
 *  room is left between the timer and the text box, so a phone with a short
 *  keyboard gets big type instead of a small clue floating over empty space,
 *  and a long clue on a small phone shrinks only as far as it must. If even
 *  `min` doesn't fit, the card scrolls rather than going below a readable size.
 *
 *  The outer region is `flex-1`, so it must sit in a flex column. */
export default function FitClue({
  text, label, min = 16, max = 30, cardClassName = '', regionClassName = '', showLabel = true,
}: {
  text: string
  label: string
  min?: number
  max?: number
  cardClassName?: string
  regionClassName?: string
  showLabel?: boolean
}) {
  const regionRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    const region = regionRef.current, card = cardRef.current, el = textRef.current
    if (!region || !card || !el) return
    const fits = (px: number) => {
      el.style.fontSize = `${px}px`
      // A few px of slack: scrollHeight rounds, and a sub-pixel overflow would
      // still pop a scrollbar on a clue that visibly fits
      return card.scrollHeight <= region.clientHeight - 4
    }
    const fit = () => {
      if (region.clientHeight === 0) return
      if (fits(max)) return
      // Binary search to the nearest half pixel
      let lo = min, hi = max
      while (hi - lo > 0.5) {
        const mid = (lo + hi) / 2
        if (fits(mid)) lo = mid; else hi = mid
      }
      el.style.fontSize = `${lo}px`
    }
    fit()
    // Keyboard open/close resizes the region; the card's own size changes don't
    // feed back into it (region is flex-1 / min-h-0), so this can't loop.
    const ro = new ResizeObserver(fit)
    ro.observe(region)
    return () => ro.disconnect()
  }, [text, min, max, showLabel])

  return (
    <div ref={regionRef} className={`flex-1 min-h-0 ${regionClassName}`}>
      <div ref={cardRef} className={`glass-card rounded-2xl max-h-full overflow-y-auto ${cardClassName}`}>
        {showLabel && (
          <p className="text-xs text-amber-400/70 uppercase tracking-[0.2em] mb-2">{label}</p>
        )}
        <p ref={textRef} className="font-bold leading-snug" style={{ fontSize: `${max}px` }}>{text}</p>
      </div>
    </div>
  )
}
