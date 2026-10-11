"""Validation for recipe and meal records.

The format is deliberately small so a chat session can produce it reliably.
Every rule here exists because the site depends on it:

- step ``uses`` must name real ingredient ids, because the cook card prints
  those ingredients (with scaled amounts) on the step itself;
- ``pairs_with`` and meal ``recipes`` must be slugs, because the site links
  them;
- ``qty`` must be numeric or null, because the serving scaler multiplies it.
"""

import re

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

ROLES = ("main", "side", "starch", "salad", "sauce", "soup", "dessert", "drink", "component")
EFFORTS = ("weeknight", "weekend")
STATUSES = ("tested", "draft")

# The site is public. Prose fields are written in the impersonal voice: no
# personal pronouns, and nothing that names a person. A note like "X's recipe"
# or "as he makes it" reads as a dossier on whoever owns the cookbook.
PERSONAL_RE = re.compile(
    r"\b(?:he|him|his|she|her|hers|me|my|mine|we|us|our|ours|myself|himself|herself)\b"
    r"|\bI(?:'m|'ve|'d|'ll)?\b"
    r"|\b[A-Z][a-z]+'s (?:recipe|version|numbers?|marinade|method|notes?|take|way|usual|own|go-to)\b",
    re.IGNORECASE,
)
PERSONAL_RE_CASE = re.compile(r"\bI(?:'m|'ve|'d|'ll)?\b")  # "I" only when capitalised

PROSE_FIELDS = ("title", "summary", "notes")


def find_personal(text):
    """Return the first personal word in a prose string, or None."""
    if not isinstance(text, str):
        return None
    for m in PERSONAL_RE.finditer(text):
        word = m.group(0)
        if word.lower() in ("i", "i'm", "i've", "i'd", "i'll") and not PERSONAL_RE_CASE.search(word):
            continue
        if word == "US":  # "US cups", not the pronoun
            continue
        return word
    return None


def _check_prose(obj, fields, where, problems):
    for key in fields:
        hit = find_personal(obj.get(key))
        if hit:
            problems.append(
                f"{where}'{key}' reads personal ({hit!r}); the site is public, so write it without names or pronouns"
            )


REQUIRED_RECIPE = ("id", "title", "role", "effort", "protein", "genre", "serves", "ingredients", "steps")
REQUIRED_MEAL = ("id", "title", "recipes")


class ValidationError(ValueError):
    """Raised with a list of human-readable problems."""

    def __init__(self, problems):
        self.problems = list(problems)
        super().__init__("; ".join(self.problems))


def _is_slug(value):
    return isinstance(value, str) and bool(SLUG_RE.match(value))


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _check_str(obj, key, problems, required=True):
    if key not in obj:
        if required:
            problems.append(f"missing '{key}'")
        return
    if not isinstance(obj[key], str) or not obj[key].strip():
        problems.append(f"'{key}' must be a non-empty string")


def _check_ingredient(ing, index, problems, seen_ids):
    where = f"ingredients[{index}]"
    if not isinstance(ing, dict):
        problems.append(f"{where} must be an object")
        return
    if not _is_slug(ing.get("id")):
        problems.append(f"{where}.id must be a slug")
    elif ing["id"] in seen_ids:
        problems.append(f"{where}.id '{ing['id']}' is duplicated")
    else:
        seen_ids.add(ing["id"])
    _check_str(ing, "item", problems)
    qty = ing.get("qty")
    qty_ok = qty is None or (_is_number(qty) and qty > 0)
    if not qty_ok:
        problems.append(f"{where}.qty must be a positive number or null")
    qty_max = ing.get("qty_max")
    if qty_max is not None:
        if qty is None:
            problems.append(f"{where}.qty_max needs a qty")
        elif qty_ok and (not _is_number(qty_max) or qty_max <= qty):
            problems.append(f"{where}.qty_max must be a number greater than qty")
    for opt in ("unit", "prep", "note", "group"):
        if opt in ing and (not isinstance(ing[opt], str)):
            problems.append(f"{where}.{opt} must be a string")
    _check_prose(ing, ("note",), where + ".", problems)
    if "optional" in ing and not isinstance(ing["optional"], bool):
        problems.append(f"{where}.optional must be true or false")


def _check_step(step, index, problems, ingredient_ids, used_ids):
    where = f"steps[{index}]"
    if not isinstance(step, dict):
        problems.append(f"{where} must be an object")
        return
    _check_str(step, "text", problems)
    if "title" in step and not isinstance(step["title"], str):
        problems.append(f"{where}.title must be a string")
    _check_prose(step, ("title", "text"), where + ".", problems)
    uses = step.get("uses", [])
    if not isinstance(uses, list):
        problems.append(f"{where}.uses must be a list of ingredient ids")
    else:
        for ref in uses:
            if ref not in ingredient_ids:
                problems.append(f"{where}.uses references unknown ingredient '{ref}'")
            else:
                used_ids.add(ref)
    timer = step.get("timer_min")
    if timer is not None and (not _is_number(timer) or timer <= 0):
        problems.append(f"{where}.timer_min must be a positive number")


def validate_recipe(recipe):
    """Return a list of warnings. Raise ValidationError on hard problems."""
    problems = []
    warnings = []
    if not isinstance(recipe, dict):
        raise ValidationError(["recipe must be a JSON object"])

    for key in REQUIRED_RECIPE:
        if key not in recipe:
            problems.append(f"missing '{key}'")
    if problems:
        raise ValidationError(problems)

    if not _is_slug(recipe["id"]):
        problems.append("'id' must be a slug like 'korean-bbq-chicken'")
    _check_str(recipe, "title", problems)
    if recipe["role"] not in ROLES:
        problems.append(f"'role' must be one of {', '.join(ROLES)}")
    if recipe["effort"] not in EFFORTS:
        problems.append(f"'effort' must be one of {', '.join(EFFORTS)}")
    _check_str(recipe, "protein", problems)
    _check_str(recipe, "genre", problems)
    if not _is_number(recipe["serves"]) or recipe["serves"] <= 0:
        problems.append("'serves' must be a positive number")
    if recipe.get("status", "tested") not in STATUSES:
        problems.append(f"'status' must be one of {', '.join(STATUSES)}")

    for opt in ("summary", "notes"):
        if opt in recipe and not isinstance(recipe[opt], str):
            problems.append(f"'{opt}' must be a string")
    _check_prose(recipe, PROSE_FIELDS, "", problems)

    time = recipe.get("time")
    if time is not None:
        if not isinstance(time, dict):
            problems.append("'time' must be an object with active_min/total_min")
        else:
            for key in ("active_min", "total_min"):
                val = time.get(key)
                if val is not None and (not _is_number(val) or val < 0):
                    problems.append(f"'time.{key}' must be a non-negative number")

    source = recipe.get("source")
    if source is not None:
        if not isinstance(source, dict):
            problems.append("'source' must be an object with name/url")
        else:
            for key in ("name", "url"):
                if key in source and not isinstance(source[key], str):
                    problems.append(f"'source.{key}' must be a string")

    tags = recipe.get("tags", [])
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        problems.append("'tags' must be a list of strings")

    pairs = recipe.get("pairs_with", [])
    if not isinstance(pairs, list) or not all(_is_slug(p) for p in pairs):
        problems.append("'pairs_with' must be a list of recipe slugs")
    elif recipe["id"] in pairs:
        problems.append("'pairs_with' must not include the recipe itself")

    ingredients = recipe["ingredients"]
    if not isinstance(ingredients, list) or not ingredients:
        problems.append("'ingredients' must be a non-empty list")
        ingredients = []
    ingredient_ids = set()
    for i, ing in enumerate(ingredients):
        _check_ingredient(ing, i, problems, ingredient_ids)

    steps = recipe["steps"]
    if not isinstance(steps, list) or not steps:
        problems.append("'steps' must be a non-empty list")
        steps = []
    used_ids = set()
    for i, step in enumerate(steps):
        _check_step(step, i, problems, ingredient_ids, used_ids)

    if problems:
        raise ValidationError(problems)

    for ing_id in sorted(ingredient_ids - used_ids):
        warnings.append(f"ingredient '{ing_id}' is never used by a step")
    return warnings


def validate_meal(meal):
    """Return a list of warnings. Raise ValidationError on hard problems."""
    problems = []
    if not isinstance(meal, dict):
        raise ValidationError(["meal must be a JSON object"])
    for key in REQUIRED_MEAL:
        if key not in meal:
            problems.append(f"missing '{key}'")
    if problems:
        raise ValidationError(problems)

    if not _is_slug(meal["id"]):
        problems.append("'id' must be a slug like 'korean-bbq-night'")
    _check_str(meal, "title", problems)
    recipes = meal["recipes"]
    if not isinstance(recipes, list) or not recipes or not all(_is_slug(r) for r in recipes):
        problems.append("'recipes' must be a non-empty list of recipe slugs")
    elif len(set(recipes)) != len(recipes):
        problems.append("'recipes' must not repeat a recipe")
    if "notes" in meal and not isinstance(meal["notes"], str):
        problems.append("'notes' must be a string")
    _check_prose(meal, ("title", "notes"), "", problems)
    if "effort" in meal and meal["effort"] not in EFFORTS:
        problems.append(f"'effort' must be one of {', '.join(EFFORTS)}")
    if problems:
        raise ValidationError(problems)
    return []
