---
name: cookbook
description: Save a recipe or meal that worked into Philip's cookbook site (the claude-cloud-scratch repo). Use when Philip says a recipe worked, asks to save it, asks to add it to the cookbook, or wants a meal saved. Also use when he asks what is already in the cookbook or what goes with a recipe.
---

# Cookbook

Philip's recipes live as one JSON file each in the GitHub repo
`philipak/claude-cloud-scratch`, under `cookbook/recipes/`. Saved meals live in
`cookbook/meals/`. A push to `main` rebuilds the site. The site is read-only;
this skill is the only way recipes get in.

## When to save

Only when Philip says the recipe worked, or explicitly asks to save it.
A recipe still being developed stays in the chat. If he wants to save
something he has not cooked yet, save it with `"status": "draft"`.

## Before writing

1. List `cookbook/recipes/` in the repo so you know the existing ids. Reuse
   the same spellings for `protein` and `genre` that existing files use; every
   new spelling becomes a separate filter chip on the site.
2. Pick the id: lowercase slug of the title, e.g. `oven-roasted-chili-broccoli`.
   If that id already exists and this is a revision, overwrite it. If it is a
   different recipe with a similar name, make the id more specific.
3. Decide `pairs_with` from the conversation: what Philip said he served it
   with, or what he asked for it to go with. Use existing ids. It is fine to
   list an id that does not exist yet (the build only warns), but say so.

## The format

Required: `id`, `title`, `role`, `effort`, `protein`, `genre`, `serves`,
`ingredients`, `steps`. The full reference is `cookbook/README.md` in the repo.

```json
{
  "id": "oven-roasted-chili-broccoli",
  "title": "Oven-Roasted Chili Pepper Broccoli",
  "role": "side",
  "effort": "weeknight",
  "protein": "none",
  "genre": "any",
  "status": "tested",
  "serves": 4,
  "time": {"active_min": 10, "total_min": 30},
  "summary": "One sentence for the card.",
  "tags": ["sheet-pan"],
  "pairs_with": ["korean-bbq-chicken", "flank-steak"],
  "ingredients": [
    {"id": "broccoli", "qty": 1.5, "unit": "lb", "item": "broccoli", "prep": "cut into florets"},
    {"id": "chili-flakes", "qty": 1, "qty_max": 2, "unit": "tsp", "item": "red pepper flakes"},
    {"id": "salt", "qty": null, "item": "flaky salt", "note": "to finish", "optional": true}
  ],
  "steps": [
    {"title": "Toss", "text": "Toss the broccoli with the chili flakes.", "uses": ["broccoli", "chili-flakes"]},
    {"title": "Roast", "text": "Roast 15 minutes.", "uses": ["broccoli"], "timer_min": 15}
  ],
  "notes": "Anything Philip said about what to change next time."
}
```

Rules that the build enforces (a violation blocks the whole site):

- `role` is one of `main`, `side`, `starch`, `salad`, `sauce`, `soup`,
  `dessert`, `drink`, `component`. `effort` is `weeknight` or `weekend`.
- `qty` is a number or `null`. Never `"2"`, never `"a pinch"`. Put words in
  `note`. Use decimals for fractions: `0.5`, `0.25`, `0.333`.
- Every `uses` entry is an ingredient `id` in the same recipe.
- The filename is `<id>.json` and `id` inside matches it.

Rules that matter for cooking:

- **`uses` is the whole point.** The cook card shows one step at a time and
  prints that step's ingredients with amounts on the card, so Philip never has
  to scroll back to the list. Every ingredient a step touches goes in its
  `uses`. Every ingredient must appear in at least one step.
- One action per step. Short title, then the text. Put the "why" in the text
  when it changes what you do ("don't lift the lid").
- `timer_min` on any step with a wait: marinate, roast, rest, soak.
- `effort` is Philip's judgment, not total minutes. A 90-minute recipe with
  15 active minutes is a weeknight recipe.
- Sources: keep `source.name` and `source.url` for anything adapted from NYT
  Cooking or elsewhere, and write the step text in your own words. Ingredient
  lists and method are fine to keep; their prose is not.

## Meals

When Philip says a combination is a meal he wants to keep, write
`cookbook/meals/<id>.json`:

```json
{
  "id": "korean-bbq-night",
  "title": "Korean BBQ Night",
  "effort": "weeknight",
  "recipes": ["korean-bbq-chicken", "oven-roasted-chili-broccoli", "steamed-short-grain-rice"],
  "notes": "Start the rice soaking first; marinate while it soaks."
}
```

Every id in `recipes` must already exist in `cookbook/recipes/`.

## How to save

**If this chat has the GitHub connector:** create or update the file at
`cookbook/recipes/<id>.json` (or `cookbook/meals/<id>.json`) on branch
`main` of `philipak/claude-cloud-scratch`, commit message
`Add recipe: <Title>` or `Update recipe: <Title>`. Then tell Philip the site
rebuilds in about a minute. If the Actions run fails, the validation message
names the field; fix and commit again.

**If this chat cannot reach GitHub:** output the complete JSON in a single
code block, headed by the filename, and say:

> Paste this into a Claude Code cloud session on `claude-cloud-scratch` with
> "add this to the cookbook". That session will validate it, commit it, and
> the site rebuilds once it lands on `main`.

Never output a partial file for Philip to merge by hand.

## Answering questions

"What goes with X" and "what do I have for a weeknight chicken" are answered by
reading `cookbook/recipes/` from the repo, not from memory. If the chat cannot
reach GitHub, say so and point him at the site.
