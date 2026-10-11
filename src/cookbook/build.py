"""Compile cookbook/recipes and cookbook/meals into the static site.

    python3 -m cookbook.build            # writes dist/ next to the repo root
    python3 -m cookbook.build --check    # validate only, no output

Run from the repo root with PYTHONPATH=src, or via the tests.
"""

import argparse
import json
import os
import shutil
import sys

from .schema import ValidationError, validate_meal, validate_recipe

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
COOKBOOK_DIR = os.path.join(REPO_ROOT, "cookbook")


class BuildError(Exception):
    pass


def load_dir(path):
    """Load every *.json file in a directory as (filename, parsed) pairs, sorted."""
    if not os.path.isdir(path):
        return []
    out = []
    for name in sorted(os.listdir(path)):
        if not name.endswith(".json"):
            continue
        full = os.path.join(path, name)
        with open(full, encoding="utf-8") as fh:
            try:
                out.append((name, json.load(fh)))
            except json.JSONDecodeError as exc:
                raise BuildError(f"{full}: invalid JSON: {exc}") from exc
    return out


def _check_filename(name, record, label, problems):
    stem = name[: -len(".json")]
    if record.get("id") != stem:
        problems.append(f"{label} file '{name}' has id '{record.get('id')}', expected '{stem}'")


def compile_data(recipes, meals):
    """Validate and cross-link records.

    ``recipes`` and ``meals`` are lists of (filename, dict). Returns
    ``(data, warnings)`` where ``data`` is the JSON-serialisable payload the
    site loads. Raises BuildError listing every hard problem found.
    """
    problems = []
    warnings = []
    by_id = {}

    for name, recipe in recipes:
        try:
            for w in validate_recipe(recipe):
                warnings.append(f"{name}: {w}")
        except ValidationError as exc:
            problems.extend(f"{name}: {p}" for p in exc.problems)
            continue
        _check_filename(name, recipe, "recipe", problems)
        if recipe["id"] in by_id:
            problems.append(f"{name}: duplicate recipe id '{recipe['id']}'")
        by_id[recipe["id"]] = recipe

    if problems:
        raise BuildError("\n".join(problems))

    # Pairings are symmetric: if A lists B, B shows A. A pairing must point
    # at a recipe that exists, because the deploy runs this same check and a
    # broken link would otherwise block the whole site.
    pairs = {rid: set() for rid in by_id}
    for rid, recipe in by_id.items():
        for other in recipe.get("pairs_with", []):
            if other not in by_id:
                problems.append(f"{rid}.json: pairs_with '{other}' is not a recipe in this cookbook")
                continue
            pairs[rid].add(other)
            pairs[other].add(rid)
    if problems:
        raise BuildError("\n".join(problems))

    out_recipes = []
    for rid in sorted(by_id):
        recipe = dict(by_id[rid])
        recipe.setdefault("status", "tested")
        recipe.setdefault("tags", [])
        recipe["pairs_with"] = sorted(pairs[rid])
        out_recipes.append(recipe)

    out_meals = []
    seen_meals = set()
    for name, meal in meals:
        try:
            validate_meal(meal)
        except ValidationError as exc:
            problems.extend(f"{name}: {p}" for p in exc.problems)
            continue
        _check_filename(name, meal, "meal", problems)
        if meal["id"] in seen_meals:
            problems.append(f"{name}: duplicate meal id '{meal['id']}'")
        seen_meals.add(meal["id"])
        missing = [r for r in meal["recipes"] if r not in by_id]
        if missing:
            problems.append(f"{name}: references unknown recipes: {', '.join(missing)}")
        out_meals.append(dict(meal))

    if problems:
        raise BuildError("\n".join(problems))

    out_meals.sort(key=lambda m: m["id"])
    facets = {
        "protein": sorted({r["protein"] for r in out_recipes}),
        "genre": sorted({r["genre"] for r in out_recipes}),
        "role": sorted({r["role"] for r in out_recipes}),
        "effort": sorted({r["effort"] for r in out_recipes}),
    }
    return {"recipes": out_recipes, "meals": out_meals, "facets": facets}, warnings


def build(cookbook_dir=COOKBOOK_DIR, out_dir=None, check_only=False):
    """Validate everything and, unless check_only, write the site to out_dir."""
    recipes = load_dir(os.path.join(cookbook_dir, "recipes"))
    meals = load_dir(os.path.join(cookbook_dir, "meals"))
    data, warnings = compile_data(recipes, meals)
    if check_only or out_dir is None:
        return data, warnings

    site_dir = os.path.join(cookbook_dir, "site")
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    shutil.copytree(site_dir, out_dir)
    with open(os.path.join(out_dir, "data.json"), "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    # Pages serves 404s for unknown paths; the app routes by hash so one
    # index is enough, but a .nojekyll keeps Pages from mangling anything.
    open(os.path.join(out_dir, ".nojekyll"), "w").close()
    return data, warnings


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="validate only")
    parser.add_argument("--out", default=os.path.join(REPO_ROOT, "dist"))
    parser.add_argument("--cookbook", default=COOKBOOK_DIR)
    args = parser.parse_args(argv)
    try:
        data, warnings = build(args.cookbook, None if args.check else args.out, args.check)
    except (BuildError, ValidationError) as exc:
        print("cookbook: build failed", file=sys.stderr)
        print(exc, file=sys.stderr)
        return 1
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    verb = "checked" if args.check else f"built {args.out} with"
    print(f"cookbook: {verb} {len(data['recipes'])} recipes, {len(data['meals'])} meals")
    return 0


if __name__ == "__main__":
    sys.exit(main())
