import { supabase } from './supabase'

// ── JSON format (matches CLAUDE.md spec) ─────────────────────

interface ImportQuestion {
  point_value: number
  answer: string
  correct_question: string
}
interface ImportCategory {
  name: string
  /** Optional host-read flavor text for the round-start category reveal.
   *  Requires the categories.description column (supabase/add_category_descriptions.sql). */
  description?: string
  questions: ImportQuestion[]
}
interface ImportRound {
  round: number
  categories: ImportCategory[]
}
interface ImportFinalJeopardy {
  category: string
  answer: string
  correct_question: string
}

export interface ContentJSON {
  rounds: ImportRound[]
  /** Preferred key for the final question block */
  final_tap?: ImportFinalJeopardy
  /** Legacy key — still accepted so old content files keep importing */
  final_jeopardy?: ImportFinalJeopardy
}

/** The final question under either its current or legacy key */
function finalBlock(content: ContentJSON): ImportFinalJeopardy | undefined {
  return content.final_tap ?? content.final_jeopardy
}

export interface ContentSummary {
  round1: number
  round2: number
  hasFinalJeopardy: boolean
}

// ── Validation ───────────────────────────────────────────────

function validate(content: ContentJSON): void {
  if (!Array.isArray(content.rounds) || content.rounds.length === 0)
    throw new Error('Content must have at least one round.')
  for (const round of content.rounds) {
    if (!Array.isArray(round.categories))
      throw new Error(`Round ${round.round} must have a categories array.`)
    for (const cat of round.categories) {
      if (!cat.name?.trim())
        throw new Error('All categories must have a name.')
      if (cat.description !== undefined && typeof cat.description !== 'string')
        throw new Error(`Category "${cat.name}": description must be a string.`)
      if (!Array.isArray(cat.questions) || cat.questions.length === 0)
        throw new Error(`Category "${cat.name}" must have at least one question.`)
      for (const q of cat.questions) {
        if (!q.answer?.trim() || !q.correct_question?.trim())
          throw new Error(`All questions in "${cat.name}" must have answer and correct_question.`)
        if (typeof q.point_value !== 'number')
          throw new Error(`All questions in "${cat.name}" must have a numeric point_value.`)
      }
    }
  }
  const fj = finalBlock(content)
  if (fj) {
    if (!fj.category?.trim() || !fj.answer?.trim() || !fj.correct_question?.trim())
      throw new Error('final_tap must have category, answer, and correct_question.')
  }
}

// ── Import ───────────────────────────────────────────────────

export async function importContent(roomId: string, content: ContentJSON): Promise<void> {
  // Validate BEFORE touching the database
  validate(content)

  // Probe the optional columns BEFORE the destructive clear below — otherwise
  // the delete succeeds, the first insert fails on a missing column, and the
  // room is left with no content.
  const [{ error: descErr }, { error: posErr }] = await Promise.all([
    supabase.from('categories').select('description').limit(1),
    supabase.from('categories').select('position').limit(1),
  ])
  // Descriptions are content the host would lose silently, so a missing column
  // is a hard stop. Position only affects ordering, so it degrades to
  // alphabetical (what every board did before) rather than blocking the import.
  const hasDescriptions = content.rounds.some(r => r.categories.some(c => c.description?.trim()))
  if (hasDescriptions && descErr) throw new Error(
    'This content has category descriptions, but the database is missing the description column. ' +
    'Run supabase/add_category_descriptions.sql in the Supabase SQL editor, then import again. Nothing was imported.'
  )
  const canOrder = !posErr

  // Clear existing content — CASCADE will delete questions too
  const { error: clearErr } = await supabase
    .from('categories')
    .delete()
    .eq('room_id', roomId)
  if (clearErr) throw new Error(`Clear failed: ${clearErr.message}`)

  // Track all inserted question IDs (with category) per round so we can randomly
  // mark two per round as Double Taps
  const insertedByRound = new Map<number, Array<{ id: string; categoryId: string }>>()

  for (const round of content.rounds) {
    const roundIds: Array<{ id: string; categoryId: string }> = []
    for (const [catIdx, cat] of round.categories.entries()) {
      // Optional columns are only included when we have something to write AND
      // the column exists, so content still imports on a database that is
      // missing either migration
      const { data: category, error: catErr } = await supabase
        .from('categories')
        .insert({
          room_id: roomId,
          name: cat.name,
          round: round.round,
          ...(cat.description?.trim() ? { description: cat.description.trim() } : {}),
          ...(canOrder ? { position: catIdx } : {}),
        })
        .select()
        .single()
      if (!category || catErr) throw new Error(`Category "${cat.name}": ${catErr?.message}`)

      const { data: inserted, error: qErr } = await supabase.from('questions').insert(
        cat.questions.map(q => ({
          category_id: category.id,
          answer: q.answer,
          correct_question: q.correct_question,
          point_value: q.point_value,
        }))
      ).select('id')
      if (qErr) throw new Error(`Questions for "${cat.name}": ${qErr.message}`)
      if (inserted) roundIds.push(...inserted.map((r: { id: string }) => ({ id: r.id, categoryId: category.id })))
    }
    insertedByRound.set(round.round, roundIds)
  }

  // Randomly pick 2 questions per round (rounds 1 & 2 only) and mark as Double Taps —
  // in different categories when the round has more than one category.
  for (const roundNum of [1, 2]) {
    const pool = insertedByRound.get(roundNum)
    if (!pool || pool.length === 0) continue
    const first = pool[Math.floor(Math.random() * pool.length)]
    const otherCategories = pool.filter(q => q.categoryId !== first.categoryId)
    const secondPool = otherCategories.length > 0 ? otherCategories : pool.filter(q => q.id !== first.id)
    const picks = [first.id]
    if (secondPool.length > 0) picks.push(secondPool[Math.floor(Math.random() * secondPool.length)].id)
    await supabase.from('questions').update({ is_double_tap: true }).in('id', picks)
  }

  // Final Tap — point_value is null (wager determines scoring)
  const finalTap = finalBlock(content)
  if (finalTap) {
    const fj = finalTap
    const { data: fjCat, error: fjCatErr } = await supabase
      .from('categories')
      .insert({ room_id: roomId, name: fj.category, round: 3 })
      .select()
      .single()
    if (!fjCat || fjCatErr) throw new Error(`FJ category: ${fjCatErr?.message}`)

    const { error: fjQErr } = await supabase.from('questions').insert([{
      category_id: fjCat.id,
      answer: fj.answer,
      correct_question: fj.correct_question,
      point_value: null,
    }])
    if (fjQErr) throw new Error(`FJ question: ${fjQErr.message}`)
  }
}

// ── Summary ──────────────────────────────────────────────────

export async function getContentSummary(roomId: string): Promise<ContentSummary | null> {
  const { data } = await supabase
    .from('categories')
    .select('round')
    .eq('room_id', roomId)
  if (!data || data.length === 0) return null
  return {
    round1: data.filter(c => c.round === 1).length,
    round2: data.filter(c => c.round === 2).length,
    hasFinalJeopardy: data.some(c => c.round === 3),
  }
}
