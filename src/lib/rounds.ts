// Central round model. Every screen (host, player, projector) and the importer
// derive round numbers, room statuses, labels, and Double Tap limits from here
// so adding or renaming a round never means hunting down `status === 'round_2'`
// ternaries across three routes.
//
// The database mirrors this file: supabase/add_round_three_2_game_logic.sql carries the same
// status → round mapping and the same Double Tap floors. Change both together.

import type { RoomStatus } from './types'

export type RegularRound = 1 | 2 | 3
export type RegularRoundStatus = 'round_1' | 'round_2' | 'round_3'

export interface RoundDefinition {
  round: RegularRound
  status: RegularRoundStatus
  /** "Round 2" — headings, host controls, board strip */
  label: string
  /** "R2" — the host lobby content summary */
  shortLabel: string
  /** "ROUND 2" — the full-screen transition splash on phones + projector */
  splash: string
  /** One-liner under the splash */
  splashTagline: string
  /** Double Tap wager ceiling floor: a team may always wager up to
   *  max(score, floor). Must match double_tap_floor() in the database. */
  doubleTapFloor: number
  /** Copy for the score-map intermission shown AFTER this round ends */
  intermission: {
    eyebrow: string
    title: string
    /** Phone footer line — tells players what is coming */
    playerNext: string
    /** Projector subtitle */
    projectorNext: string
  }
}

// ── Double Tap floors ──────────────────────────────────────────────
// One explicit table. Rounds 1 and 2 keep their historical values; Round 3 has
// no product-supplied number yet, so it uses 3000 (the "hardest board, biggest
// swing" assumption — see the AGENTS.md / docs/game-flow.md note). If the value
// changes, update supabase/add_round_three_2_game_logic.sql's double_tap_floor() to match.
export const DOUBLE_TAP_MIN_WAGER = 5
export const DOUBLE_TAP_FLOORS: Record<RegularRound, number> = {
  1: 500,
  2: 2000,
  3: 3000,
}

export const REGULAR_ROUNDS: readonly RoundDefinition[] = [
  {
    round: 1,
    status: 'round_1',
    label: 'Round 1',
    shortLabel: 'R1',
    splash: 'ROUND 1',
    splashTagline: 'Tap in when you know it 🍺',
    doubleTapFloor: DOUBLE_TAP_FLOORS[1],
    intermission: {
      eyebrow: 'Round 1 in the books',
      title: '🍻 Round One Down',
      playerNext: 'Round 2 is coming — bigger points on the board. Refill while you can 🍺',
      projectorNext: 'Round 2 up next — bigger points on the board',
    },
  },
  {
    round: 2,
    status: 'round_2',
    label: 'Round 2',
    shortLabel: 'R2',
    splash: 'ROUND 2',
    splashTagline: 'Bigger points on the board 🍺',
    doubleTapFloor: DOUBLE_TAP_FLOORS[2],
    intermission: {
      eyebrow: 'Round 2 in the books',
      title: '🍻 Round Two Down',
      playerNext: 'Round 3 is coming — the biggest board of the night. One more refill 🍺',
      projectorNext: 'Round 3 up next — the biggest points of the night',
    },
  },
  {
    round: 3,
    status: 'round_3',
    label: 'Round 3',
    shortLabel: 'R3',
    splash: 'ROUND 3',
    splashTagline: 'Biggest points of the night 🍺',
    doubleTapFloor: DOUBLE_TAP_FLOORS[3],
    intermission: {
      eyebrow: 'Round 3 in the books',
      title: '🍻 Last Call',
      playerNext: 'Final Tap is next — one question, wager what you dare 🍺',
      projectorNext: 'Final Tap up next — one wager decides it all',
    },
  },
]

export const REGULAR_ROUND_NUMBERS: readonly RegularRound[] = REGULAR_ROUNDS.map(r => r.round)
export const FIRST_ROUND: RegularRound = 1
export const LAST_REGULAR_ROUND: RegularRound = 3

/** `categories.round` used for a newly imported Final Tap category. Kept above
 *  every regular round so Final Tap can never collide with a playable board.
 *  Historical rooms stored Final Tap as round 3 (when only two regular rounds
 *  existed) — see src/lib/finalTap.ts for the backward-compatible lookup. */
export const FINAL_TAP_STORAGE_ROUND = 4
export const LEGACY_FINAL_TAP_STORAGE_ROUND = 3

export const FINAL_TAP_LABEL = 'Final Tap'

// ── Lookups ────────────────────────────────────────────────────────

export function isRegularRound(value: unknown): value is RegularRound {
  return typeof value === 'number' && (REGULAR_ROUND_NUMBERS as readonly number[]).includes(value)
}

export function isRegularRoundStatus(status: string | null | undefined): status is RegularRoundStatus {
  return REGULAR_ROUNDS.some(r => r.status === status)
}

export function roundDefinition(round: RegularRound): RoundDefinition {
  return REGULAR_ROUNDS[round - 1]
}

/** `'round_2'` → 2. Null for lobby / Final Tap / finished. */
export function statusToRound(status: string | null | undefined): RegularRound | null {
  return REGULAR_ROUNDS.find(r => r.status === status)?.round ?? null
}

export function roundToStatus(round: RegularRound): RegularRoundStatus {
  return roundDefinition(round).status
}

export function roundLabel(round: RegularRound): string {
  return roundDefinition(round).label
}

/** The regular round that follows `round`, or null when Final Tap is next. */
export function nextRegularRound(round: RegularRound): RegularRound | null {
  const next = round + 1
  return isRegularRound(next) ? next : null
}

/** Room status that follows a regular round: the next round, or Final Tap after
 *  the last one. Null when `status` is not a regular round. */
export function nextStatusAfter(status: string | null | undefined): RoomStatus | null {
  const round = statusToRound(status)
  if (round === null) return null
  const next = nextRegularRound(round)
  return next === null ? 'final_jeopardy' : roundToStatus(next)
}

/** Human label for what follows a regular round ("Round 2" or "Final Tap"). */
export function nextPhaseLabel(round: RegularRound): string {
  const next = nextRegularRound(round)
  return next === null ? FINAL_TAP_LABEL : roundLabel(next)
}

export function isLastRegularRound(round: RegularRound): boolean {
  return nextRegularRound(round) === null
}

// ── Double Tap wager limits ────────────────────────────────────────

/** Wager floor for a room status. Unknown/non-round statuses fall back to the
 *  Round 1 floor so a stale client can never widen the limit. */
export function doubleTapFloor(status: string | null | undefined): number {
  const round = statusToRound(status)
  return DOUBLE_TAP_FLOORS[round ?? FIRST_ROUND]
}

/** Maximum Double Tap wager: the team's score or the round floor, whichever is
 *  larger. Same rule as confirm_question_selection / judge_buzz in the database. */
export function doubleTapMaxWager(score: number, status: string | null | undefined): number {
  return Math.max(score, doubleTapFloor(status))
}

/** Clamp a typed wager into the legal range for this team and round. */
export function clampDoubleTapWager(raw: number, score: number, status: string | null | undefined): number {
  const max = doubleTapMaxWager(score, status)
  return Math.max(DOUBLE_TAP_MIN_WAGER, Math.min(max, Number.isNaN(raw) ? DOUBLE_TAP_MIN_WAGER : raw))
}
