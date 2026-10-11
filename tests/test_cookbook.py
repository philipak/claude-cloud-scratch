import copy
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from cookbook import ValidationError, validate_meal, validate_recipe  # noqa: E402
from cookbook.build import BuildError, build, compile_data  # noqa: E402

REPO_ROOT = os.path.join(os.path.dirname(__file__), "..")
COOKBOOK_DIR = os.path.join(REPO_ROOT, "cookbook")


def good_recipe(**over):
    recipe = {
        "id": "test-chicken",
        "title": "Test Chicken",
        "role": "main",
        "effort": "weeknight",
        "protein": "chicken",
        "genre": "korean",
        "serves": 4,
        "ingredients": [
            {"id": "chicken", "qty": 2, "unit": "lb", "item": "chicken thighs"},
            {"id": "salt", "qty": None, "item": "salt", "note": "to taste"},
        ],
        "steps": [
            {"text": "Season the chicken.", "uses": ["chicken", "salt"]},
            {"text": "Roast.", "uses": ["chicken"], "timer_min": 25},
        ],
    }
    recipe.update(over)
    return recipe


def good_meal(**over):
    meal = {"id": "test-night", "title": "Test Night", "recipes": ["test-chicken"]}
    meal.update(over)
    return meal


class ValidateRecipe(unittest.TestCase):
    def test_minimal_recipe_passes_with_no_warnings(self):
        self.assertEqual(validate_recipe(good_recipe()), [])

    def test_missing_required_fields(self):
        with self.assertRaises(ValidationError) as cm:
            validate_recipe({"id": "x"})
        joined = " ".join(cm.exception.problems)
        for key in ("title", "role", "effort", "protein", "genre", "serves", "ingredients", "steps"):
            self.assertIn(f"'{key}'", joined)

    def test_rejects_bad_slug_role_effort(self):
        for over in ({"id": "Test Chicken"}, {"role": "entree"}, {"effort": "someday"}):
            with self.assertRaises(ValidationError):
                validate_recipe(good_recipe(**over))

    def test_step_must_reference_real_ingredient(self):
        recipe = good_recipe()
        recipe["steps"][0]["uses"] = ["gochujang"]
        with self.assertRaises(ValidationError) as cm:
            validate_recipe(recipe)
        self.assertIn("unknown ingredient 'gochujang'", cm.exception.problems[0])

    def test_unused_ingredient_is_a_warning_not_an_error(self):
        recipe = good_recipe()
        recipe["ingredients"].append({"id": "lime", "qty": 1, "item": "lime"})
        warnings = validate_recipe(recipe)
        self.assertEqual(len(warnings), 1)
        self.assertIn("'lime' is never used", warnings[0])

    def test_qty_rules(self):
        recipe = good_recipe()
        recipe["ingredients"][0]["qty"] = "2"
        with self.assertRaises(ValidationError):
            validate_recipe(recipe)
        recipe = good_recipe()
        recipe["ingredients"][0]["qty_max"] = 1  # less than qty 2
        with self.assertRaises(ValidationError):
            validate_recipe(recipe)
        recipe = good_recipe()
        recipe["ingredients"][0]["qty_max"] = 3
        self.assertEqual(validate_recipe(recipe), [])

    def test_duplicate_ingredient_ids(self):
        recipe = good_recipe()
        recipe["ingredients"].append({"id": "salt", "qty": None, "item": "flaky salt"})
        with self.assertRaises(ValidationError):
            validate_recipe(recipe)

    def test_cannot_pair_with_self(self):
        with self.assertRaises(ValidationError):
            validate_recipe(good_recipe(pairs_with=["test-chicken"]))

    def test_status_defaults_and_is_restricted(self):
        self.assertEqual(validate_recipe(good_recipe(status="draft")), [])
        with self.assertRaises(ValidationError):
            validate_recipe(good_recipe(status="maybe"))


class ValidateMeal(unittest.TestCase):
    def test_good_meal(self):
        self.assertEqual(validate_meal(good_meal()), [])

    def test_rejects_empty_or_repeated_recipes(self):
        with self.assertRaises(ValidationError):
            validate_meal(good_meal(recipes=[]))
        with self.assertRaises(ValidationError):
            validate_meal(good_meal(recipes=["a", "a"]))


class CompileData(unittest.TestCase):
    def test_pairings_are_symmetric(self):
        chicken = good_recipe(pairs_with=["test-broccoli"])
        broccoli = good_recipe(id="test-broccoli", title="Broccoli", role="side", protein="none")
        data, warnings = compile_data(
            [("test-chicken.json", chicken), ("test-broccoli.json", broccoli)], []
        )
        by_id = {r["id"]: r for r in data["recipes"]}
        self.assertEqual(by_id["test-chicken"]["pairs_with"], ["test-broccoli"])
        self.assertEqual(by_id["test-broccoli"]["pairs_with"], ["test-chicken"])
        self.assertEqual(warnings, [])

    def test_unknown_pairing_fails_the_build(self):
        with self.assertRaises(BuildError) as cm:
            compile_data([("test-chicken.json", good_recipe(pairs_with=["nope"]))], [])
        self.assertIn("pairs_with 'nope' is not a recipe", str(cm.exception))

    def test_filename_must_match_id(self):
        with self.assertRaises(BuildError) as cm:
            compile_data([("other.json", good_recipe())], [])
        self.assertIn("expected 'other'", str(cm.exception))

    def test_meal_referencing_unknown_recipe_fails(self):
        with self.assertRaises(BuildError) as cm:
            compile_data([("test-chicken.json", good_recipe())], [("test-night.json", good_meal(recipes=["ghost"]))])
        self.assertIn("unknown recipes: ghost", str(cm.exception))

    def test_facets_and_defaults(self):
        data, _ = compile_data([("test-chicken.json", good_recipe())], [("test-night.json", good_meal())])
        self.assertEqual(data["facets"]["protein"], ["chicken"])
        self.assertEqual(data["facets"]["effort"], ["weeknight"])
        self.assertEqual(data["recipes"][0]["status"], "tested")
        self.assertEqual(data["recipes"][0]["tags"], [])
        self.assertEqual(data["meals"][0]["id"], "test-night")

    def test_all_problems_reported_at_once(self):
        bad1 = good_recipe(id="bad-one", role="entree")
        bad2 = good_recipe(id="bad-two", effort="someday")
        with self.assertRaises(BuildError) as cm:
            compile_data([("bad-one.json", bad1), ("bad-two.json", bad2)], [])
        self.assertIn("bad-one.json", str(cm.exception))
        self.assertIn("bad-two.json", str(cm.exception))


class RepoCookbook(unittest.TestCase):
    """The checked-in recipes are data the site ships; they must build clean."""

    def test_checked_in_cookbook_builds(self):
        data, warnings = build(COOKBOOK_DIR, out_dir=None, check_only=True)
        self.assertGreater(len(data["recipes"]), 0)
        self.assertEqual(warnings, [], "checked-in recipes should carry no warnings")

    def test_build_writes_site(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "dist")
            build(COOKBOOK_DIR, out_dir=out)
            for name in ("index.html", "app.js", "style.css", "robots.txt", "data.json", ".nojekyll"):
                self.assertTrue(os.path.exists(os.path.join(out, name)), name)
            with open(os.path.join(out, "data.json"), encoding="utf-8") as fh:
                payload = json.load(fh)
            self.assertEqual({r["id"] for r in payload["recipes"]}, {r["id"] for r in build(COOKBOOK_DIR, check_only=True)[0]["recipes"]})

    def test_site_asks_not_to_be_indexed(self):
        with open(os.path.join(COOKBOOK_DIR, "site", "robots.txt"), encoding="utf-8") as fh:
            self.assertIn("Disallow: /", fh.read())
        with open(os.path.join(COOKBOOK_DIR, "site", "index.html"), encoding="utf-8") as fh:
            self.assertIn('name="robots" content="noindex', fh.read())


if __name__ == "__main__":
    unittest.main()
