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
    def test_missing_production_titles_fail_instead_of_dropping_nominees(self):
        rows = [["year", "category", "name", "show", "won", "nominated"],
                ["1986", "Musical", "Producer credits", "", 0, 1]]
        with self.assertRaisesRegex(ValueError, "Missing production nominee title"):
            ml_data.production_nominees(rows)

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

    def test_model_comparison_methods_agree_on_known_effect(self):
        did = tony_causal.did_frame(self.units, self.panel)
        rows = tony_causal.model_comparison(did, "d_log_gross", tony_causal.CONTROLS, "won")
        self.assertEqual([r["kind"] for r in rows], ["linear", "lasso", "ml", "ml"])
        for row in rows:
            self.assertAlmostEqual(row["percent"], 20.0, delta=4.0, msg=row["model"])
            low, high = row["percentCi95"]
            self.assertLess(low, row["percent"])
            self.assertGreater(high, row["percent"])
            self.assertEqual(row["n"], len(did))
        self.assertLessEqual(rows[1]["controlsKept"], rows[1]["controlsOffered"])

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


def synthetic_nominations(lift=1.25, years=range(2008, 2020), seed=5):
    """Per year: 4 production nominees (1 wins), 3 un-nominated shows, 1 acting-only nominee."""
    rng = np.random.default_rng(seed)
    rows, nominees, ceremonies, nominations, tony = [], [], {}, {}, [["header"] * 6]
    for year in years:
        ceremony = pd.Timestamp(f"{year}-06-01") + pd.offsets.Week(weekday=6)
        nomination = ceremony - pd.Timedelta(weeks=5)
        ceremonies[year], nominations[year] = ceremony, (nomination, "verified")
        shocks = {k: rng.normal(scale=0.04) for k in range(-12, 15)}
        for i, letter in enumerate("abcdefgh"):
            title = f"Play {year} {letter}"
            nominated = i < 4
            if nominated:
                nominees.append((year, title, "Play", int(i == 0)))
                tony.append([year, "Play", title, title, int(i == 0), 1])
            if i == 7:
                tony.append([year, "Actor", "Someone", title, 0, 1])
            base = rng.uniform(3e5, 1e6)
            for k in range(-12, 15):
                gross = base * np.exp(shocks[k] + rng.normal(scale=0.02))
                gross *= lift if nominated and k >= 1 else 1.0
                week = (nomination + pd.Timedelta(weeks=k)).strftime("%Y-%m-%d")
                rows.append([week, week[:4], title, gross, 6000, 8000, gross / 6000, 1])
    return ml_data.history_frame(rows), ceremonies, nominations, nominees, tony


@unittest.skipUnless(HAS_ML, "numpy/pandas are installed only for the ML workflow")
class NominationTests(unittest.TestCase):
    def setUp(self):
        (self.history, self.ceremonies, self.nominations, self.nominees,
         tony) = synthetic_nominations()
        self.units = tony_causal.nomination_units(
            self.history, self.nominations, self.ceremonies, self.nominees,
            tony_causal.nominated_titles(tony))
        self.panel = tony_causal.nomination_panel(self.history, self.units)

    def test_groups_exclude_shows_nominated_only_in_other_categories(self):
        counts = self.units.groupby("group").size().to_dict()
        years = len(self.ceremonies)
        self.assertEqual(counts, {"won": years, "nominatedLost": 3 * years,
                                  "notNominated": 3 * years})
        self.assertFalse(self.units["show"].str.endswith(" h").any())

    def test_nomination_effect_recovered_and_placebo_null(self):
        frame = tony_causal.nomination_frame(self.units, self.panel)
        self.assertTrue((frame["post_n"] == 5).all())
        result = tony_causal.ols_effect(frame, "d_log_gross", tony_causal.NOM_CONTROLS, 200,
                                        log=True, treatment="nominated")
        self.assertAlmostEqual(result["percent"], 25.0, delta=2.0)
        self.assertEqual(result["treated"], 4 * len(self.ceremonies))
        placebo = tony_causal.nomination_frame(self.units, self.panel,
                                               tony_causal.NOM_PLACEBO_PRE,
                                               tony_causal.NOM_PLACEBO_POST)
        null = tony_causal.ols_effect(placebo, "d_log_gross", tony_causal.NOM_CONTROLS, 100,
                                      log=True, treatment="nominated")
        self.assertLess(abs(null["percent"]), 2.0)

    def test_lifecycle_indexes_each_show_to_its_weeks_before_nomination(self):
        latest = self.history["week"].max() + pd.Timedelta(weeks=52)
        table = tony_causal.lifecycle(self.units, self.panel, latest)
        self.assertEqual(table["won"]["beforeNomination"], 100.0)
        self.assertAlmostEqual(table["notNominated"]["afterNomination"], 100.0, delta=5.0)
        self.assertAlmostEqual(table["nominatedLost"]["afterNomination"], 125.0, delta=6.0)
        self.assertAlmostEqual(table["won"]["afterTony"], 125.0, delta=6.0)
        spread = table["won"]["afterTonySpread"]
        self.assertLessEqual(spread["p10"], spread["p25"])
        self.assertLessEqual(spread["p25"], spread["p50"])
        self.assertLessEqual(spread["p75"], spread["p90"])
        self.assertEqual(spread["p50"], table["won"]["afterTony"])
        self.assertNotIn("stillRunning8WeeksAfterTony", table["won"])

    def test_run_length_separates_winners_that_keep_running(self):
        history = self.history.copy()
        year = history["show"].str.extract(r"(\d{4})")[0].astype(int)
        ceremony = year.map(self.ceremonies)
        loser = ~history["show"].str.endswith(" a")
        history = history[~(loser & (history["week"] > ceremony + pd.Timedelta(weeks=3)))].copy()
        history["run_end"] = history.groupby("run_id")["week"].transform("max")
        units = tony_causal.nomination_units(
            history, self.nominations, self.ceremonies, self.nominees,
            tony_causal.nominated_titles(synthetic_nominations()[4]))
        panel = tony_causal.nomination_panel(history, units)
        latest = history["week"].max() + pd.Timedelta(weeks=60)
        runs = tony_causal.run_length(units, panel, latest)
        groups = runs["groups"]
        self.assertEqual(groups["won"]["medianWeeksAfterTony"], 9)
        self.assertEqual(groups["nominatedLost"]["medianWeeksAfterTony"], 3)
        self.assertEqual(groups["notNominated"]["medianWeeksAfterTony"], 3)
        self.assertEqual(groups["won"]["stillOpen"], 0)
        self.assertLess(runs["logRankP"]["wonVsLost"], 0.001)
        self.assertGreater(runs["logRankP"]["lostVsNotNominated"], 0.9)
        self.assertEqual(runs["regression"]["13"]["won"]["points"], 0.0)

    def test_run_length_censors_shows_still_open(self):
        latest = self.history["week"].max()
        runs = tony_causal.run_length(self.units, self.panel, latest)
        self.assertEqual(runs["groups"]["won"]["stillOpen"], 1)


@unittest.skipUnless(HAS_ML, "numpy/pandas are installed only for the ML workflow")
class SurvivalMathTests(unittest.TestCase):
    def test_kaplan_meier_handles_censoring(self):
        curve, median = tony_causal.kaplan_meier([1, 2, 2, 3], [True, True, False, True], weeks=4)
        self.assertEqual(curve, [100.0, 75.0, 50.0, 0.0, 0.0])
        self.assertEqual(median, 2)

    def test_log_rank_detects_different_curves_only(self):
        same = tony_causal.log_rank([1, 2, 3, 1, 2, 3], [True] * 6, list("aaabbb"))
        self.assertGreater(same, 0.99)
        times = list(range(1, 21)) + list(range(30, 50))
        far = tony_causal.log_rank(times, [True] * 40, ["a"] * 20 + ["b"] * 20)
        self.assertLess(far, 0.001)


@unittest.skipUnless(HAS_ML, "numpy/pandas are installed only for the ML workflow")
class NominationWeekTests(unittest.TestCase):
    def test_verified_dates_snap_to_week_end_and_others_use_median_gap(self):
        ceremonies = {2018: pd.Timestamp("2018-06-10"), 2019: pd.Timestamp("2019-06-09"),
                      2012: pd.Timestamp("2012-06-10"), 2021: pd.Timestamp("2021-09-26")}
        verified = {"2018": {"date": "2018-05-01"}, "2019": {"date": "2019-04-30"}}
        weeks, gap = ml_data.nomination_weeks(ceremonies, verified)
        self.assertEqual(weeks[2018], (pd.Timestamp("2018-05-06"), "verified"))
        self.assertEqual(weeks[2019], (pd.Timestamp("2019-05-05"), "verified"))
        self.assertEqual(gap, 5)
        self.assertEqual(weeks[2012], (pd.Timestamp("2012-05-06"), "approximate"))
        self.assertNotIn(2021, weeks)



@unittest.skipUnless(HAS_ML, "numpy/pandas not installed")
class CategoryTests(unittest.TestCase):
    def test_category_group_maps_production_acting_creative_and_skips_honorary(self):
        group = tony_causal.category_group
        self.assertEqual(group("Musical"), "production")
        self.assertEqual(group("Revival of a Play"), "production")
        self.assertEqual(group("Best Actress in a Leading Role in a Musical"), "acting")
        self.assertEqual(group("Best Featured Actor in a Play"), "acting")
        self.assertEqual(group("Best Direction of a Musical"), "creative")
        self.assertEqual(group("Best Original Score"), "creative")
        self.assertIsNone(group("Special Tony Award"))

    def test_tony_flags_mark_group_and_gender_nominations_and_wins(self):
        header = ["year", "category", "person", "show", "won", "nominated"]
        rows = [header,
                [2019, "Musical", "", "Hadestown", 1, 1],
                [2019, "Best Actress in a Leading Role in a Musical", "X", "Hadestown", 0, 1],
                [2019, "Best Featured Actor in a Musical", "Y", "Hadestown", 1, 1],
                [2019, "Special Tony Award", "Z", "Other", 1, 1],
                [2019, "Play", "", "Not nominated", 0, 0]]
        flags = tony_causal.tony_flags(rows)
        self.assertEqual(set(flags), {(2019, "Hadestown")})
        entry = flags[(2019, "Hadestown")]
        for key in ("nom_production", "won_production", "nom_acting", "won_acting",
                    "nom_actress", "nom_actor", "won_actor"):
            self.assertEqual(entry.get(key), 1, key)
        self.assertNotIn("won_actress", entry)

    def test_term_effects_recover_known_effects_with_ols_and_double_ml(self):
        rng = np.random.default_rng(11)
        n = 900
        frame = pd.DataFrame({"year": rng.integers(2000, 2010, n),
                              "prior": rng.normal(size=n)})
        frame["a"] = (rng.random(n) < 0.3 + 0.2 * (frame["prior"] > 0)).astype(int)
        frame["b"] = (rng.random(n) < 0.3).astype(int)
        frame["y"] = (np.log(1.20) * frame["a"] + 0.0 * frame["b"] + 0.3 * frame["prior"]
                      + 0.02 * (frame["year"] - 2000) + rng.normal(scale=0.05, size=n))
        out = tony_causal.term_effects(frame, "y", ["a", "b"], ["prior"], compare=[("a", "b")])
        self.assertEqual(out["n"], n)
        for est in (out["a"], out["a"]["doubleML"]):
            self.assertAlmostEqual(est["percent"], 20.0, delta=3.0)
            self.assertLess(est["percentCi95"][0], 20.0)
            self.assertGreater(est["percentCi95"][1], 20.0)
        self.assertGreater(out["b"]["pValue"], 0.01)
        self.assertLess(out["a_vs_b_p"], 0.001)
        self.assertLess(out["a_vs_b_p_doubleML"], 0.001)

if __name__ == "__main__":
    unittest.main()
