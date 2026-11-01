import csv
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from scripts import collect_wikipedia_reviews as wiki
from scripts import freeze_grosses_snapshot as freeze

HAS_PANDAS = importlib.util.find_spec("pandas") is not None
HAS_VADER = importlib.util.find_spec("vaderSentiment") is not None

ARTICLE = """Intro paragraph about a musical that played on Broadway.

== Production ==
It opened at the Imperial Theatre.

== Critical reception ==
Critics adored the score. Ben Brantley called it a dazzling, joyous evening.

=== Later reviews ===
The revival was praised as a triumph. It grossed $2 million in its first week.

== Awards and nominations ==
It won the Tony Award for Best Musical.
"""


class WikipediaCollectorTests(unittest.TestCase):
    def test_reception_section_includes_subsections_only(self):
        heading, text = wiki.reception_text(ARTICLE)
        self.assertEqual(heading, "Critical reception")
        self.assertIn("dazzling", text)
        self.assertIn("revival was praised", text)
        self.assertNotIn("Tony Award for Best Musical", text)
        self.assertNotIn("Imperial Theatre", text)

    def test_leaky_sentences_are_dropped_before_scoring(self):
        _, text = wiki.reception_text(ARTICLE)
        kept = wiki.review_sentences(text)
        self.assertTrue(any("joyous" in s for s in kept))
        self.assertFalse(any("grossed" in s or "$" in s for s in kept))

    def test_broadway_article_filter(self):
        self.assertTrue(wiki.is_broadway_article("Hamilton (musical)", ARTICLE))
        self.assertFalse(wiki.is_broadway_article("Hamilton", "A city in Ontario."))

    def test_resolve_follows_redirects_and_skips_disambiguation(self):
        def fetch(params):
            return {"query": {
                "redirects": [{"from": "Annie (musical)", "to": "Annie (1977 musical)"}],
                "pages": [{"title": "Annie (1977 musical)"},
                          {"title": "Annie (play)", "missing": True},
                          {"title": "Annie", "pageprops": {"disambiguation": ""}}]}}
        found = wiki.resolve(wiki.candidates("Annie"), fetch)
        self.assertEqual(found, {"Annie (musical)": "Annie (1977 musical)"})

    def test_shows_to_collect_uses_modern_runs_only(self):
        weeks = [("1990-01-07", "Old Show"), ("1999-01-03", "New Show"),
                 ("1995-12-31", "Bridge"), ("1996-01-07", "Bridge")]
        self.assertEqual(wiki.shows_to_collect(weeks), ["Bridge", "New Show"])


class SnapshotTests(unittest.TestCase):
    ROWS = [["2024-01-07", "2024", "Show A", 1000.0, 10, 20, 100.0, 1],
            ["2024-01-07", "2024", "Show A", 500.0, 5, 10, 100.0, 1],
            ["2024-01-07", "2024", "Show B", 800.0, 8, 8, 100.0, 1]]

    def test_snapshot_rows_aggregate_duplicates_into_numeric_facts(self):
        rows = freeze.snapshot_rows(self.ROWS)
        self.assertEqual(rows[0], ["2024-01-07", "Show A", 1500.0, 15, 30, 0.5, 100.0])
        self.assertEqual(rows[1][5], 1.0)

    def test_freeze_writes_csv_manifest_pointer_and_refuses_to_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "history-dashboard-data.json").write_text(
                json.dumps({"rows": self.ROWS}), encoding="utf-8")
            manifest = freeze.freeze(root, "20240110")
            folder = root / "data" / "snapshots"
            self.assertEqual((folder / "CURRENT").read_text().strip(), manifest["file"])
            with (folder / manifest["file"]).open(newline="") as handle:
                rows = list(csv.reader(handle))
            self.assertEqual(rows[0], freeze.COLUMNS)
            self.assertEqual(manifest["rows"], 2)
            self.assertIn("playbill.com/grosses", manifest["source"])
            with self.assertRaises(SystemExit):
                freeze.freeze(root, "20240111")
            self.assertEqual(wiki.snapshot_weeks(root)[0], ("2024-01-07", "Show A"))
            if HAS_PANDAS:
                from scripts import ml_data
                history, through = ml_data.load_snapshot(root)
                self.assertEqual(through, "2024-01-07")
                self.assertEqual(len(history), 2)
                self.assertAlmostEqual(
                    history.loc[history["show"] == "Show A", "capacity"].iloc[0], 0.5)


@unittest.skipUnless(HAS_VADER, "vaderSentiment is installed only for the ML workflow")
class SentimentTests(unittest.TestCase):
    def test_scores_contain_numbers_and_attribution_but_no_text(self):
        from scripts import score_review_sentiment as sentiment
        _, text = wiki.reception_text(ARTICLE)
        cache = {"source": "Wikipedia", "license": "CC BY-SA 4.0", "licenseUrl": "u",
                 "showsConsidered": 1,
                 "pages": {"annie": {"show": "Annie", "article": "Annie (1977 musical)",
                                     "url": "https://en.wikipedia.org/wiki/Annie",
                                     "revisionId": 1, "revisionTimestamp": "t",
                                     "text": text}}}
        result = sentiment.score(cache)
        scored = result["shows"]["annie"]
        self.assertGreater(scored["compoundMean"], 0.3)
        self.assertNotIn("text", scored)
        self.assertNotIn("dazzling", json.dumps(result))
        self.assertIn("CC BY-SA", result["attribution"])


if __name__ == "__main__":
    unittest.main()
