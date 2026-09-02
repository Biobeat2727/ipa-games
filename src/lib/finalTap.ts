// Backward-compatible Final Tap discovery.
//
// Final Tap used to be "the category with round === 3". With three regular
// rounds that assumption breaks: round 3 is now a playable board. New imports
// store the Final Tap category as FINAL_TAP_STORAGE_ROUND (4); historical rooms
// still have it at round 3. The one property that has ALWAYS identified the
// Final clue is `point_value is null` (wager-scored), so every lookup here keys
// on that and merely prefers the new storage round when both exist.
//
// Public clients (player, projector) must call this with `source: 'public'`,
// which reads only ids/point values through questions_public — never the clue
// text. The clue itself is fetched by id only after rooms.final_phase permits
// it, exactly as before.

import { supabase } from './supabase'
import { FINAL_TAP_STORAGE_ROUND, LEGACY_FINAL_TAP_STORAGE_ROUND } from './rounds'

export interface FinalTapCategoryRef {
  id: string
  name: string
  round: number
  /** The null-value Final clue owned by this category */
  questionId: string
}

type CategoryLike = { round: number; questions: Array<{ point_value: number | null }> }

/** Does this in-memory category row hold the Final Tap clue (rather than a
 *  playable board column)? Used to keep Final Tap out of the host question list
 *  for both storage layouts. */
export function isFinalTapCategory(cat: CategoryLike): boolean {
  if (cat.round === FINAL_TAP_STORAGE_ROUND) return true
  return cat.questions.length > 0 && cat.questions.every(q => q.point_value === null)
}

/** Categories that are real boards (rounds 1–3), excluding the Final Tap row. */
export function regularCategories<T extends CategoryLike>(cats: T[]): T[] {
  return cats.filter(c => !isFinalTapCategory(c))
}

/**
 * Find the room's Final Tap category and clue id.
 *  - `source: 'host'`   → reads `questions` (host-only table; needs host auth)
 *  - `source: 'public'` → reads `questions_public`, ids and point values only
 * Returns null when the content has no Final Tap block.
 */
export async function findFinalTapCategory(
  roomId: string,
  source: 'host' | 'public',
): Promise<FinalTapCategoryRef | null> {
  const { data: cats, error } = await supabase
    .from('categories')
    .select('id, name, round')
    .eq('room_id', roomId)
    .in('round', [FINAL_TAP_STORAGE_ROUND, LEGACY_FINAL_TAP_STORAGE_ROUND])
  if (error || !cats || cats.length === 0) return null

  const catIds = cats.map(c => c.id)
  // Two literal branches (not a computed table name) so the Database generic
  // keeps the column types for each relation.
  const { data: finals } = source === 'host'
    ? await supabase.from('questions').select('id, category_id').in('category_id', catIds).is('point_value', null)
    : await supabase.from('questions_public').select('id, category_id').in('category_id', catIds).is('point_value', null)
  const finalByCategory = new Map<string, string>(
    (finals ?? []).map((q: { id: string; category_id: string }) => [q.category_id, q.id])
  )

  // Prefer the current storage round, then the legacy one; within a round the
  // first category holding a null-value clue wins (imports only ever write one).
  const ordered = [...cats].sort((a, b) =>
    (a.round === FINAL_TAP_STORAGE_ROUND ? 0 : 1) - (b.round === FINAL_TAP_STORAGE_ROUND ? 0 : 1)
  )
  for (const cat of ordered) {
    const questionId = finalByCategory.get(cat.id)
    if (questionId) return { id: cat.id, name: cat.name, round: cat.round, questionId }
  }
  return null
}
