# claude-cloud-scratch

Scratch repo for exercising cloud sessions. Low stakes by design.

- Standard library only. Do not add dependencies or a package manager.
- Tests are stdlib `unittest`, run with
  `python3 -m unittest discover -s tests -v`. Keep it that way so the suite
  runs in a bare sandbox with no install step.
- Treat the tests as the specification. Change `src/`, not `tests/`, unless
  a test is provably wrong.

## Cookbook

`cookbook/` is Philip's personal recipe site: one JSON file per recipe in
`cookbook/recipes/`, one per meal in `cookbook/meals/`, compiled by
`src/cookbook` into a static site that GitHub Pages serves from `main`.
Format and rules: `cookbook/README.md`. The chat-side instructions that
produce these files: `cookbook/SKILL.md`.

When Philip pastes a recipe and says "add this to the cookbook":

1. Write it to `cookbook/recipes/<id>.json` (meals to `cookbook/meals/`).
   Do not reshape it beyond what validation requires; say what you changed.
2. Run `python3 -m unittest tests.test_cookbook`. A warning about an unused
   ingredient is a real problem: add it to the step that uses it.
3. Commit as `Add recipe: <Title>`. The site only rebuilds from `main`, so
   tell him the branch it landed on if it was not `main`.

The checked-in seed recipes are `"status": "draft"` because Philip has not
cooked them; do not mark anything `tested` on his behalf.
