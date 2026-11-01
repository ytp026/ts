import importlib.util
import unittest

HAS_ML = all(importlib.util.find_spec(m) for m in ("numpy", "pandas", "sklearn"))

if HAS_ML:
    import numpy as np
    import pandas as pd
    from scripts import forecast, ml_data


def weekly_rows(show, start, weeks, base=1e6, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for k in range(weeks):
        week = (pd.Timestamp(start) + pd.Timedelta(weeks=k)).strftime("%Y-%m-%d")
        gross = base * np.exp(rng.normal(scale=0.05))
        rows.append([week, week[:4], show, gross, 7000, 8000, gross / 7000, 1])
    return rows


@unittest.skipUnless(HAS_ML, "numpy/pandas/scikit-learn are installed only for the ML workflow")
class ForecastFeatureTests(unittest.TestCase):
    def setUp(self):
        rows = (weekly_rows("Long Runner", "2018-01-07", 400, seed=1)
                + weekly_rows("Short Run", "2019-01-06", 20, base=4e5, seed=2)
                + weekly_rows("Just Closed", "2025-06-01", 40, base=5e5, seed=3))
        self.history = ml_data.history_frame(rows)
        self.latest = self.history["week"].max()
        self.frame = forecast.build_features(self.history, latest=self.latest)

    def test_target_is_next_week_log_change_and_features_use_only_the_past(self):
        show = self.frame[self.frame["show"] == "Long Runner"].sort_values("week")
        row = show.iloc[10]
        nxt = show.iloc[11]
        self.assertAlmostEqual(row["y_gross_chg"], nxt["log_gross"] - row["log_gross"])
        self.assertAlmostEqual(row["next_gross"], nxt["gross"])
        self.assertAlmostEqual(row["log_gross_l1"], show.iloc[9]["log_gross"])
        self.assertAlmostEqual(row["roll4"], show.iloc[7:11]["log_gross"].mean())
        self.assertEqual(row["target_week"], nxt["week"])

    def test_closing_label_is_censored_near_the_data_edge(self):
        short = self.frame[self.frame["show"] == "Short Run"].sort_values("week")
        self.assertEqual(short["y_close"].iloc[0], 0.0)
        self.assertEqual(short["y_close"].iloc[-1], 1.0)
        recent = self.frame[self.frame["show"] == "Just Closed"]
        self.assertTrue(recent["y_close"].iloc[-8:].isna().all())

    def test_shutdown_labels_are_excluded(self):
        shutdown = self.frame[(self.frame["week"] >= forecast.EXCLUDE[0])
                              & (self.frame["week"] <= forecast.EXCLUDE[1])]
        self.assertTrue(shutdown["y_gross_chg"].isna().all())
        self.assertTrue(shutdown["y_close"].isna().all())

    def test_time_split_has_no_overlap_and_trims_closing_horizon(self):
        train, valid, test = forecast.split(self.frame, "y_gross_chg")
        self.assertLess(train["target_week"].max(), forecast.VALID_START)
        self.assertGreaterEqual(test["target_week"].min(), forecast.TEST_START)
        c_train, c_valid, _ = forecast.split(self.frame, "y_close")
        reach = pd.Timedelta(weeks=forecast.CLOSE_HORIZON)
        self.assertTrue((c_train["week"] + reach < forecast.VALID_START).all())
        self.assertTrue((c_valid["week"] + reach < forecast.TEST_START).all())


@unittest.skipUnless(HAS_ML, "numpy/pandas/scikit-learn are installed only for the ML workflow")
class MonitoringTests(unittest.TestCase):
    def test_psi_flags_shifted_distribution_only(self):
        rng = np.random.default_rng(0)
        reference = rng.normal(size=5000)
        self.assertLess(forecast.psi(reference, rng.normal(size=2000)), 0.1)
        self.assertGreater(forecast.psi(reference, rng.normal(1.0, 1, 2000)), 0.25)
        self.assertIsNone(forecast.psi([1.0], [1.0]))

    def test_prediction_log_appends_once_and_joins_actuals(self):
        history = pd.DataFrame({"week": pd.to_datetime(["2025-01-12"]), "show": ["A"],
                                "gross": [110.0]})
        scored = [{"show": "A", "targetWeek": "2025-01-12", "predictedGross": 100,
                   "lastGross": 90, "closeProbability": 0.1}]
        log = forecast.update_prediction_log({}, scored, history, "2025-01-05")
        log = forecast.update_prediction_log(log, scored, history, "2025-01-05")
        self.assertEqual(len(log["entries"]), 1)
        self.assertEqual(log["entries"][0]["actualGross"], 110.0)
        self.assertEqual(log["summary"]["maturedForecasts"], 1)
        self.assertAlmostEqual(log["summary"]["modelMape"], 100 * 10 / 110, places=2)

    def test_gross_errors_and_paired_bootstrap(self):
        errors = forecast.gross_errors([100, 200], [110, 180])
        self.assertAlmostEqual(errors["mape"], 10.0)
        self.assertAlmostEqual(errors["wape"], 100 * 30 / 300, places=3)
        a, b = np.full(50, 0.1), np.full(50, 0.2)
        ci = forecast.paired_bootstrap(a, b, lambda v, r: v[r].mean(), np.arange(50), reps=50)
        self.assertAlmostEqual(ci[0], -0.1)
        self.assertAlmostEqual(ci[1], -0.1)

    def test_low_capacity_rule_handles_capacity_above_one(self):
        capacity = [1.06, 0.5, 0.9, 1.0, 0.2]
        score = forecast.low_capacity_score(capacity)
        np.testing.assert_allclose(score, [0.0, 0.5, 0.1, 0.0, 0.8])
        metrics = forecast.classification_metrics([0, 1, 0, 0, 1], score)
        self.assertEqual(metrics["rocAuc"], 1.0)

    def test_drift_windows_use_recent_non_overlapping_reference(self):
        weeks = pd.date_range("2020-01-05", periods=300, freq="7D")
        snapshot = pd.DataFrame({"week": weeks})
        latest = weeks[-1]
        reference, current, start, end = forecast.drift_windows(snapshot, snapshot, latest)
        self.assertEqual(len(current), 8)
        self.assertEqual(len(reference), 52)
        self.assertLess(reference["week"].max(), current["week"].min())
        self.assertEqual(end, latest - pd.Timedelta(weeks=8))
        self.assertEqual(start, end - pd.Timedelta(weeks=51))

    def test_market_check_compares_weekly_values_year_over_year(self):
        weeks = pd.date_range("2024-01-07", periods=70, freq="7D")
        gross = np.where(weeks >= weeks[-8], 1.2e7, 1.0e7)
        rows = pd.DataFrame({"week": np.repeat(weeks, 3),
                             "market_log_gross": np.log(np.repeat(gross, 3))})
        check = forecast.market_check(rows, rows, weeks[-1])
        self.assertEqual(check["weeks"], 8)
        self.assertAlmostEqual(check["percentChange"], 20.0, places=2)
        self.assertEqual(check["status"], "moderate")
        self.assertNotIn("market_log_gross", forecast.DRIFT_FEATURES)

    def test_iteration_selection_returns_a_fitted_model(self):
        rng = np.random.default_rng(0)
        frame = pd.DataFrame(rng.normal(size=(600, len(forecast.FEATURES))),
                             columns=forecast.FEATURES)
        frame["y"] = frame["chg_1"] * 0.5 + rng.normal(scale=0.1, size=600)
        model, rounds = forecast.select_iterations("gross", frame[:400], frame[400:], "y")
        self.assertIn(rounds, forecast.ITERATIONS)
        self.assertEqual(model.max_iter, rounds)
        self.assertEqual(len(forecast.predict(model, frame[400:])), 200)


if __name__ == "__main__":
    unittest.main()
