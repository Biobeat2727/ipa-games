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
  "final_jeopardy": {
    "category": "Category Name",
    "answer": "The final clue",
    "correct_question": "What is the correct response"
  }
}
```

Standard: 5-6 categories per round, 5 point values each (100-500), 25-30 questions per round.
