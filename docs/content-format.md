# Content Format (JSON Import)

```json
{
  "rounds": [
    {
      "round": 1,
      "categories": [
        {
          "name": "Category Name",
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

The final question block key is `final_tap`; the legacy key `final_jeopardy` is also accepted. If the block is missing entirely, the game has no Final Tap — the host content summary shows a "⚠ NO Final Tap question" warning at import, and the Final Tap screens offer "End Game with Current Scores" as the only way to finish.
