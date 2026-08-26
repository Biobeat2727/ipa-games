import { VENMO_HANDLE, VENUE_LOGO, VENUE_NAME, VENUE_URL, venmoUrl, venueUrlLabel } from '../lib/branding'

// Venmo's brand blue — readable on the dark bar background
const VENMO_BLUE = '#3D95CE'

/** Tappable tip-jar card for player phones. Hidden until VENMO_HANDLE is set. */
export function TipJar({ style }: { style?: React.CSSProperties }) {
  if (!VENMO_HANDLE) return null
  return (
    <a
      href={venmoUrl()}
      target="_blank"
      rel="noopener noreferrer"
      className="block glass-card rounded-xl px-4 py-3 text-center no-underline"
      style={style}
    >
      <p className="text-gray-400 text-xs uppercase tracking-widest mb-1">Enjoying trivia night?</p>
      <p className="font-black text-base" style={{ color: VENMO_BLUE }}>
        💸 Tip on Venmo — @{VENMO_HANDLE}
      </p>
    </a>
  )
}

/** Big-screen tip line for the projector — not tappable, just readable across the room. */
export function TipJarProjector({ style }: { style?: React.CSSProperties }) {
  if (!VENMO_HANDLE) return null
  return (
    <p
      className="text-center font-bold text-gray-400"
      style={{ fontSize: 'clamp(0.9rem, 1.8vw, 1.5rem)', ...style }}
    >
      Enjoying the game? Tips 🍺{' '}
      <span className="font-black" style={{ color: VENMO_BLUE }}>Venmo @{VENMO_HANDLE}</span>
    </p>
  )
}

/** Venue logo + website for the end-of-game screens. `projector` renders the link as
 *  plain text (nobody can tap the big screen) at room-readable sizes. */
export function VenueFooter({ projector, style }: { projector?: boolean; style?: React.CSSProperties }) {
  if (!VENUE_LOGO && !VENUE_URL) return null
  // The badge has black text on a white ground, so it sits in a white chip
  // instead of floating on the dark bar background
  const logo = VENUE_LOGO && (
    <span className="inline-block bg-white rounded-2xl px-3 py-2">
      <img
        src={VENUE_LOGO}
        alt={VENUE_NAME}
        className="mx-auto object-contain"
        style={{ height: projector ? 'clamp(3.5rem, 10vh, 7rem)' : '4rem' }}
      />
    </span>
  )
  const label = venueUrlLabel()
  return (
    <div className="text-center space-y-2" style={style}>
      {logo}
      {VENUE_URL && (
        projector ? (
          <p className="text-gray-400 font-semibold" style={{ fontSize: 'clamp(0.9rem, 1.8vw, 1.5rem)' }}>
            {label}
          </p>
        ) : (
          <a
            href={VENUE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-semibold text-amber-300 underline underline-offset-4 decoration-amber-300/40"
          >
            {label}
          </a>
        )
      )}
    </div>
  )
}
