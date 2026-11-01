import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HAS_ML = all(importlib.util.find_spec(m) for m in ("numpy", "pandas", "sklearn"))


class MlWorkflowTests(unittest.TestCase):
    def test_weekly_ml_workflow_retrains_on_snapshot_and_publishes(self):
        workflow = (ROOT / ".github/workflows/ml-weekly.yml").read_text()
        for required in [
            "schedule:", "workflow_dispatch:",
            "if: github.ref_name == github.event.repository.default_branch",
            "contents: write", "pages: write", "group: broadway-site-refresh",
            "cancel-in-progress: false", "pip install -r requirements-ml.txt",
            "python scripts/tony_causal.py", "python scripts/forecast.py",
            "python scripts/nlp_lift.py", "actions/upload-artifact", "mlruns/",
            "git add ml/*.json", "python scripts/publish_pages.py",
        ]:
            self.assertIn(required, workflow)
        # Training data is frozen: the ML workflow never scrapes or re-collects text.
        for forbidden in ["refresh_broadway.py", "collect_wikipedia_reviews.py",
                          "freeze_grosses_snapshot.py", "push:"]:
            self.assertNotIn(forbidden, workflow)
        publishing_step = workflow.split("- name: Rebuild and verify branch-based GitHub Pages")[1]
        self.assertNotIn("if:", publishing_step)

    def test_review_text_cache_is_never_committed(self):
        ignored = (ROOT / ".gitignore").read_text().split()
        for entry in ["data/cache/", "mlruns/", ".venv/"]:
            self.assertIn(entry, ignored)


@unittest.skipUnless(HAS_ML, "numpy/pandas/scikit-learn are installed only for the ML workflow")
class NlpLiftTests(unittest.TestCase):
    def test_sentiment_join_keeps_only_scored_shows(self):
        import pandas as pd
        from scripts import nlp_lift
        frame = pd.DataFrame({"key": ["a", "a", "b"], "week": [1, 2, 1]})
        sentiment = {"shows": {"a": {"compoundMean": 0.4, "positiveShare": 0.6,
                                     "negativeShare": 0.1}}}
        joined = nlp_lift.attach_sentiment(frame, sentiment)
        self.assertEqual(list(joined["key"]), ["a", "a"])
        self.assertEqual(list(joined["sent_compound"]), [0.4, 0.4])
        empty = nlp_lift.attach_sentiment(frame, {"shows": {}})
        self.assertEqual(len(empty), 0)
        self.assertIn("sent_negative", empty.columns)


if __name__ == "__main__":
    unittest.main()
