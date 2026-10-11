# Cookbook

A personal, meal-oriented recipe site. One JSON file per recipe, one per
meal, compiled into a static site by `src/cookbook` and published with
GitHub Pages. No dependencies, no server, no login: the web is read-only and
every write is a file committed to this repo.

- `recipes/` — one `<id>.json` per recipe. Filename must equal `id`.
- `meals/` — one `<id>.json` per saved meal.
- `site/` — the app (`index.html`, `app.js`, `style.css`, `robots.txt`).
- `SKILL.md` — instructions for the cooking chat that writes recipes here.

## Build and check

```
python3 -m unittest tests.test_cookbook -v       # validates every checked-in file
PYTHONPATH=src python3 -m cookbook --check       # same, as a one-line report
PYTHONPATH=src python3 -m cookbook --out dist    # build the site into dist/
python3 -m http.server 8000 --directory dist     # then open http://localhost:8000
```

A push to `main` touching `cookbook/` runs the same check and deploys the
site (`.github/workflows/cookbook-pages.yml`). The build fails on any
validation error, so a bad file never reaches the site.

## Recipe format

```json
{
  "id": "korean-bbq-chicken",
  "title": "Korean BBQ Chicken",
  "role": "main",
  "effort": "weeknight",
  "protein": "chicken",
  "genre": "korean",
  "status": "tested",
  "serves": 4,
  "time": {"active_min": 20, "total_min": 50},
  "summary": "One line for the card.",
  "tags": ["grill", "make-ahead"],
  "pairs_with": ["roasted-chili-broccoli"],
  "source": {"name": "NYT Cooking", "url": "https://..."},
  "ingredients": [
    {"id": "gochujang", "qty": 3, "unit": "tbsp", "item": "gochujang", "group": "Marinade"},
    {"id": "garlic", "qty": 4, "unit": "cloves", "item": "garlic", "prep": "grated"},
    {"id": "chili", "qty": 1, "qty_max": 2, "unit": "tsp", "item": "red pepper flakes"},
    {"id": "salt", "qty": null, "item": "flaky salt", "note": "to finish", "optional": true}
  ],
  "steps": [
    {"title": "Marinade", "text": "Whisk the gochujang and garlic.", "uses": ["gochujang", "garlic"]},
    {"title": "Rest", "text": "Rest 10 minutes.", "uses": [], "timer_min": 10}
  ],
  "notes": "Free text shown under the recipe."
}
```

Required: `id`, `title`, `role`, `effort`, `protein`, `genre`, `serves`,
`ingredients`, `steps`. Everything else is optional.

| Field | Rule |
|---|---|
| `id` | slug: lowercase, digits, single hyphens. Must match the filename. |
| `role` | `main`, `side`, `starch`, `salad`, `sauce`, `soup`, `dessert`, `drink`, `component` |
| `effort` | `weeknight` or `weekend` |
| `protein` | free lowercase word: `chicken`, `beef`, `pork`, `fish`, `shellfish`, `tofu`, `eggs`, `none` |
| `genre` | free lowercase word: `korean`, `mexican`, `italian`, `american`, `any` … Keep spellings consistent; each distinct value becomes a filter chip. |
| `status` | `tested` (default) or `draft`. Drafts get a badge on the site. |
| `serves` | positive number. The site scales every `qty` from this. |
| `ingredients[].id` | slug, unique within the recipe. Steps reference it. |
| `ingredients[].qty` | number or `null` ("to taste"). Never a string. `qty_max` makes a range. |
| `ingredients[].unit` | optional free text: `tbsp`, `cup`, `lb`, `cloves`. Omit for countable items ("2 limes"). |
| `ingredients[].prep`, `note`, `group`, `optional` | optional. `group` labels a sub-list ("Marinade", "To finish"). |
| `steps[].uses` | ingredient ids this step needs. **This is what the cook card prints on the step**, so be complete. Empty list is fine. |
| `steps[].timer_min` | optional; the cook card shows a timer button. |
| `pairs_with` | recipe ids that go with this one. Symmetric at build time: list it on either side. Unknown ids are a warning, not an error, so you can add a main before its side exists. |

Every ingredient should be used by at least one step; the build warns if not,
and the checked-in tests treat warnings on repo files as failures.

## Meal format

```json
{
  "id": "korean-bbq-night",
  "title": "Korean BBQ Night",
  "effort": "weeknight",
  "recipes": ["korean-bbq-chicken", "roasted-chili-broccoli", "steamed-short-grain-rice"],
  "notes": "Start the rice soaking first."
}
```

Every id in `recipes` must exist. The site builds a merged shopping list and
a suggested start order (longest total time first) from the members.

## What the site does

- Search by title, ingredient, genre, protein, tag. Filter chips for
  when / protein / genre / course.
- Recipe page: scale servings, tap-to-check ingredients, "Goes with" links,
  "+ Tonight".
- Cook mode: one step per card, large type, the step's own ingredients with
  scaled amounts printed on the card, timers, swipe or tap to move, screen
  wake lock where the browser supports it.
- Meals: saved combinations with a merged shopping list. "Tonight" is the
  same view for an ad hoc pick, stored only in that browser.

Per-device state (checks, servings, Tonight) lives in the browser's local
storage and never leaves the device.

## Publishing

GitHub Pages must be enabled once in the repository settings with
**Source: GitHub Actions**. Pages on a private repository needs a paid plan,
so the practical route is making the repository public. The site carries
`robots.txt` and a `noindex` meta tag, which keeps well-behaved crawlers
out; it does not stop anyone who has the URL.
