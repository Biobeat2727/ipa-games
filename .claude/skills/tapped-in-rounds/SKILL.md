---
name: tapped-in-rounds
description: Weekly trivia round builder for Davey's "Tapped In!" bar trivia game. Use whenever Davey asks to build, draft, refresh, or audit a trivia round, categories, or questions for Tapped In / trivia night. Runs a category-menu → pick → research → fact-check → audit-doc + import-JSON pipeline.
---

# Tapped In! — Weekly Round Builder

Pipeline for producing one week's game: 2 rounds × 5 categories × 5 clues, plus one Final Tap. Past rounds live in `rounds/*.json`; the import schema is in `docs/content-format.md`.

## Non-negotiable format rules

1. **Jeopardy format, strictly.** The board shows an "answer" (a declarative clue); players respond with the "question" (e.g. "Who is Apollo?"). The single most common LLM failure is leaking the answer into the clue ("Name the red-hatted character... Answer: Mario"). Every clue must be checkable: **does the clue text contain or trivially telegraph the correct response? If yes, rewrite.**
2. **Category names ≤ 14 characters** including spaces and punctuation (mobile tap-handle constraint). Final Tap category names can run a little longer but keep them tight.
3. **JSON schema** (`docs/content-format.md`): `rounds[].categories[].questions[]` with `point_value`, `answer` (the displayed clue), `correct_question` (the expected response). Each category also takes an optional `description` string — the host-read flavor line shown on the host panel and pushed to all screens during the round-start category reveal (see `src/lib/content.ts`); always include one per category. Requires the `categories.description` column (`supabase/add_category_descriptions.sql`). The `final_tap` block takes no description. Final block key is `final_tap` with `category`, `answer`, `correct_question`. Round 1 values 100–500; Round 2 values 200–1000 (doubled).
4. **Difficulty ladder.** Within each category, difficulty must rise with point value. Round 1 = broad recall a general bar crowd can play; Round 2 = harder, wordplay- and deduction-friendly. 100-level = nearly everyone at the bar knows it; 500/1000-level = one sharp team gets it.
5. **No verbatim copying** from Jeopardy!/J-Archive or trivia sites. Research real facts (existing trivia repositories and archives are fine as *inspiration and fact sources*), then write original clue text. Cite fact-check sources in the audit doc.
6. **No repeats.** Before proposing anything, scan every file in `rounds/` (categories AND individual answers) and avoid reusing category names, gimmicks already run recently, or repeated answers.

## Pipeline

**Step 1 — Category menu.** Read `rounds/*.json` to build the used-category/used-answer history. Propose ~20 fresh candidates (10 Round-1-flavored, 10 Round-2-flavored) plus 2–3 Final Tap ideas. Mix classic Jeopardy formats (Before & After-style wordplay, anagrams, hidden words, "everything in this category shares X") with bar-friendly pop culture, food/drink, geography, science, music, sports. All names ≤14 chars. Davey picks 5 + 5 + 1 and may shoot down / request refreshes in any lane — iterate until locked.

**Step 2 — Research & draft.** For each locked category, research verifiable facts (web search; primary sources preferred). Draft 5 clues on the difficulty ladder. Where judging could be ambiguous, add a host note ("accept Kentucky Fried Chicken"). Prefer researched real-world facts; invent-from-knowledge only when research isn't turning up what's needed, and fact-check those hardest.

**Step 3 — Verification pass.** For every clue: (a) fact-check against a source; (b) answer-leak check per rule 1; (c) dedupe against all past rounds; (d) difficulty-order sanity check; (e) category name length check. Fix or replace failures before delivering.

**Step 4 — Deliverables.** Produce both:
- **Markdown audit doc** — modeled on `rounds/bar-trivia-audit-2026-08.md`: per-round host script (one read-aloud intro line per category for board reveal, plus a preamble for any gimmick category), tables of value/clue/correct response, host judging notes, audit notes, and fact-check source links.
- **Import JSON** — exact `content-format.md` schema, validated by parsing it (e.g. `python3 -c "import json; json.load(open(...))"`), values in correct order.

Save both into `rounds/` named `M-D-YY-<slug>.md/.json`. Keep the markdown and JSON in sync at all times.

**Step 5 — Edit loop.** Davey audits and requests changes ("swap the 400 in FLAG DAY", "that 1000 is too easy"). Apply edits to BOTH the markdown and JSON so they never drift. The JSON in `rounds/` is always the current truth.

Final Tap guidance: straight trivia beats deduction puzzles — aim for a know-it-or-gamble question where some teams know it cold and the rest can wager on instinct (e.g. "the Quarrymen became this band"). Deduction-style finals are fine occasionally but never two weeks running, and never one that feels like a repeat of an earlier gimmick.

## Cadence

This runs weekly. If asked to automate the kickoff, create a scheduled task that starts Step 1 and delivers the category menu before trivia night.
