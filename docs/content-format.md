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

Standard: 5-6 categories per round, 5 point values each (100-500), 25-30 questions per round.

`description` (optional, per category): one or two sentences the host reads aloud
during the round-start category reveal. When any category in a round has one,
the host gets a step-through intro panel at round start and each category pops
onto the boards Jeopardy-style as the host clicks. Descriptions appear ONLY on
the host screen — never on phones or the projector. Requires the
`categories.description` column (`supabase/add_category_descriptions.sql`);
content without descriptions imports and plays identically to before.

The final question block key is `final_tap`; the legacy key `final_jeopardy` is also accepted. If the block is missing entirely, the game has no Final Tap — the host content summary shows a "⚠ NO Final Tap question" warning at import, and the Final Tap screens offer "End Game with Current Scores" as the only way to finish.
