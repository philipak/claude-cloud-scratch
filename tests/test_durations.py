import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from durations import format_duration, parse_duration  # noqa: E402


class ParseDuration(unittest.TestCase):
    def test_single_units(self):
        self.assertEqual(parse_duration("45s"), 45)
        self.assertEqual(parse_duration("5m"), 300)
        self.assertEqual(parse_duration("2h"), 7200)
        self.assertEqual(parse_duration("1d"), 86400)

    def test_combined_units(self):
        self.assertEqual(parse_duration("1h30m"), 5400)
        self.assertEqual(parse_duration("1d2h3m4s"), 93784)

    def test_is_case_and_space_insensitive(self):
        self.assertEqual(parse_duration("  1H30M  "), 5400)

    def test_rejects_junk(self):
        for bad in ["", "   ", "90", "1x", "h30m", "1h30"]:
            with self.assertRaises(ValueError):
                parse_duration(bad)

    def test_rejects_non_strings(self):
        with self.assertRaises(TypeError):
            parse_duration(90)


class FormatDuration(unittest.TestCase):
    def test_zero(self):
        self.assertEqual(format_duration(0), "0s")

    def test_single_units(self):
        self.assertEqual(format_duration(45), "45s")
        self.assertEqual(format_duration(300), "5m")
        self.assertEqual(format_duration(7200), "2h")
        self.assertEqual(format_duration(86400), "1d")

    def test_combined_units(self):
        self.assertEqual(format_duration(5400), "1h30m")
        self.assertEqual(format_duration(93784), "1d2h3m4s")

    def test_omits_empty_units(self):
        self.assertEqual(format_duration(86460), "1d1m")

    def test_round_trips_with_parse(self):
        for text in ["45s", "5m", "2h", "1d", "1h30m", "1d2h3m4s"]:
            self.assertEqual(format_duration(parse_duration(text)), text)


if __name__ == "__main__":
    unittest.main()
