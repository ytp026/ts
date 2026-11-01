import importlib.util
import unittest

HAS_ML = all(importlib.util.find_spec(m) for m in ("numpy", "pandas"))

if HAS_ML:
    import numpy as np
    import pandas as pd
    from scripts import ml_data, tony_causal


def synthetic_season(effect=1.2, years=range(2008, 2020), seed=3):
    """Six nominees per year; one musical and one play win and get `effect` x gross."""
    rng = np.random.default_rng(seed)
    rows, nominees, ceremonies = [], [], {}
    for year in years:
        ceremony = pd.Timestamp(f"{year}-06-01") + pd.offsets.Week(weekday=6)
        ceremonies[year] = ceremony
        shocks = {k: rng.normal(scale=0.05) for k in range(-20, 21)}
        for i, letter in enumerate("abcdef"):
            title = f"Show {year} {letter}"
            category = "Musical" if i < 3 else "Play"
            won = int(i in (0, 3))
            nominees.append((year, title, category, won))
            base = rng.uniform(4e5, 1.5e6)
            for k in range(-20, 21):
                lift = effect if won and k >= 1 else 1.0
                gross = base * np.exp(shocks[k] + rng.normal(scale=0.02)) * lift
                available = 8000
                sold = int(available * min(0.98, 0.6 + 0.1 * i + (0.05 if lift > 1 else 0)))
                week = (ceremony + pd.Timedelta(weeks=k)).strftime("%Y-%m-%d")
                rows.append([week, week[:4], title, gross, sold, available, gross / sold, 1])
    return ml_data.history_frame(rows), ceremonies, nominees


@unittest.skipUnless(HAS_ML, "numpy/pandas are installed only for the ML workflow")
class TonyCausalTests(unittest.TestCase):
    def setUp(self):
        self.history, self.ceremonies, self.nominees = synthetic_season()
        self.units = tony_causal.build_units(self.history, self.ceremonies, self.nominees)
        self.panel = tony_causal.event_panel(self.history, self.units)

    def test_units_match_titles_and_flag_category(self):
        self.assertEqual(len(self.units), len(self.nominees))
        self.assertEqual(int(self.units["won"].sum()), 2 * len(self.ceremonies))
        self.assertEqual(set(self.units["musical"]), {0, 1})

    def test_difference_in_differences_recovers_known_effect(self):
        did = tony_causal.did_frame(self.units, self.panel)
        result = tony_causal.ols_effect(did, "d_log_gross", bootstrap=200, log=True)
        self.assertAlmostEqual(result["percent"], 20.0, delta=2.0)
        low, high = result["percentCi95"]
        self.assertLess(low, 20.0)
        self.assertGreater(high, 20.0)
        self.assertLess(result["pValue"], 0.001)

    def test_placebo_ceremony_shows_no_effect(self):
        placebo = tony_causal.did_frame(self.units, self.panel, tony_causal.PLACEBO_PRE,
                                        tony_causal.PLACEBO_POST)
        result = tony_causal.ols_effect(placebo, "d_log_gross", bootstrap=100, log=True)
        self.assertLess(abs(result["percent"]), 2.0)

    def test_event_study_has_flat_pre_trends_and_post_jump(self):
        did = tony_causal.did_frame(self.units, self.panel)
        events, pretrend_p, units = tony_causal.event_study(self.panel, did)
        by_week = {e["week"]: e["estimate"] for e in events}
        self.assertEqual(by_week[0], 0.0)
        self.assertLess(max(abs(by_week[w]) for w in range(-8, 0)), 0.03)
        self.assertAlmostEqual(by_week[4], np.log(1.2), delta=0.03)
        self.assertGreater(pretrend_p, 0.01)
        self.assertEqual(units, len(did))

    def test_interpretation_labels_result_as_association_with_checks(self):
        gross = {"percent": 30.8, "percentCi95": [19.6, 43.1]}
        events = [{"week": w, "estimate": -0.05 if w < 0 else 0.2 * (w > 0)}
                  for w in range(-8, 13)]
        passing = tony_causal.interpretation(
            gross, {"percent": 3.6, "percentCi95": [-4.9, 13.0]}, 0.39, events)
        self.assertEqual(passing["label"], "association")
        self.assertTrue(passing["checksPass"])
        self.assertIn("consistent with a causal effect", passing["summary"])
        self.assertIn("not a clean causal estimate", passing["summary"])
        self.assertIn("already rising", passing["summary"])
        self.assertIn("about 5% below their week-0 level", passing["summary"])
        self.assertAlmostEqual(passing["preWeeksMeanPercent"], 100 * np.expm1(-0.05), places=1)
        failing = tony_causal.interpretation(
            gross, {"percent": 15.0, "percentCi95": [5.0, 25.0]}, None, events)
        self.assertFalse(failing["checksPass"])
        self.assertIn("do not fully support", failing["summary"])
        self.assertIn("p = n/a", failing["summary"])


if __name__ == "__main__":
    unittest.main()
