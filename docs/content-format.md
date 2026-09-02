# Content Format (JSON Import)

```json
{
  "rounds": [
    {
      "round": 1,
      "categories": [
        {
          "name": "Category Name",
          "description": "Optional host-read flavor text (see below)",
          "questions": [
            {
              "point_value": 100,
              "answer": "Displayed clue",
              "correct_question": "What is the expected answer"
            }
          ]
        }
      ]
    }
  ],
  "final_tap": {
    "category": "Category Name",
    "answer": "The final clue",
    "correct_question": "What is the correct response"
  }
}
```

A game is **three regular rounds plus Final Tap**. The `rounds` array must contain
exactly one entry each for `round: 1`, `round: 2`, and `round: 3` (any order), and
every round needs at least one category. The importer validates the whole file
*before* it deletes the room's existing content, and rejects with a host-readable
message when a round number is missing (`Content is missing Round 3 …`), duplicated,
or unsupported (anything other than 1, 2, 3). Two-round files from before Round 3
existed therefore no longer import; add a `round: 3` block to reuse them.

Standard: 5 categories per round, 5 point values each, 25 questions per round.
The importer does not enforce specific values — whatever numbers the JSON supplies
are honored. The round builder's guidance (see `.claude/skills/tapped-in-rounds/SKILL.md`):

| Round | Values | Difficulty | Double Tap floor |
|---|---|---|---|
| 1 | 100–500 | broad bar-crowd recall | 1000 |
| 2 | 200–1000 | harder, wordplay/deduction | 2000 |
| 3 | 300–1500 | hardest board of the night | 3000 |

Two Double Taps are assigned at random in **each** of the three rounds (in
different categories when the round has more than one). A team may wager from 5 up
to max(its score, the round floor).

`description` (optional, per category): one or two sentences the host reads aloud
during the round-start category reveal. When any category in a round has one,
the host gets a step-through intro panel at round start and each category pops
onto the boards Jeopardy-style as the host clicks. Descriptions appear ONLY on
the host screen — never on phones or the projector. Requires the
`categories.description` column (`supabase/add_category_descriptions.sql`);
content without descriptions imports and plays identically to before.

The final question block key is `final_tap`; the legacy key `final_jeopardy` is also accepted. If the block is missing entirely, the game has no Final Tap — the host content summary shows a "⚠ NO Final Tap question" warning at import, and the Final Tap screens offer "End Game with Current Scores" as the only way to finish.

**Storage:** the Final Tap block is inserted as a category with `round = 4`
(`FINAL_TAP_STORAGE_ROUND` in `src/lib/rounds.ts`) holding one question whose
`point_value` is null (requires `supabase/add_round_three_3_category_round_check.sql`; the
importer checks this before deleting anything). Rooms imported before Round 3 existed stored it as `round = 3`.
All code finds Final Tap through `src/lib/finalTap.ts`, which keys on the null
`point_value` and prefers round 4 — never on the round number alone.

**Host lobby summary** reads `R1: n cats · R2: n cats · R3: n cats · Final Tap ✓`.
Start Game stays disabled (labelled `Content is missing Round N`) while any regular
round has zero categories; a missing Final Tap does not block starting.
