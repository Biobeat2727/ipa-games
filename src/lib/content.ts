import { supabase } from './supabase'

// ── JSON format (matches CLAUDE.md spec) ─────────────────────

interface ImportQuestion {
  point_value: number
  answer: string
  correct_question: string
}
interface ImportCategory {
  name: string
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
  final_jeopardy?: ImportFinalJeopardy
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
  if (content.final_jeopardy) {
    const fj = content.final_jeopardy
    if (!fj.category?.trim() || !fj.answer?.trim() || !fj.correct_question?.trim())
      throw new Error('final_jeopardy must have category, answer, and correct_question.')
  }
}

// ── Import ───────────────────────────────────────────────────

export async function importContent(roomId: string, content: ContentJSON): Promise<void> {
  // Validate BEFORE touching the database
  validate(content)

  // Clear existing content — CASCADE will delete questions too
  const { error: clearErr } = await supabase
    .from('categories')
    .delete()
    .eq('room_id', roomId)
  if (clearErr) throw new Error(`Clear failed: ${clearErr.message}`)

  for (const round of content.rounds) {
    for (const cat of round.categories) {
      const { data: category, error: catErr } = await supabase
        .from('categories')
        .insert({ room_id: roomId, name: cat.name, round: round.round })
        .select()
        .single()
      if (!category || catErr) throw new Error(`Category "${cat.name}": ${catErr?.message}`)

      const { error: qErr } = await supabase.from('questions').insert(
        cat.questions.map(q => ({
          category_id: category.id,
          answer: q.answer,
          correct_question: q.correct_question,
          point_value: q.point_value,
        }))
      )
      if (qErr) throw new Error(`Questions for "${cat.name}": ${qErr.message}`)
    }
  }

  // Final Jeopardy — point_value is null (wager determines scoring)
  if (content.final_jeopardy) {
    const fj = content.final_jeopardy
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
