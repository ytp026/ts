import importlib.util
import unittest

HAS_NUMPY = importlib.util.find_spec("numpy") is not None

if HAS_NUMPY:
    import numpy as np
    from scripts import ml_stats


@unittest.skipUnless(HAS_NUMPY, "numpy is installed only for the ML workflow")
class MlStatsTests(unittest.TestCase):
    def test_chi_square_survival_matches_known_critical_values(self):
        for stat, df in [(3.841458820694124, 1), (5.991464547107979, 2),
                         (7.814727903251178, 3), (9.487729036781154, 4),
                         (18.307038053275146, 10)]:
            self.assertAlmostEqual(ml_stats.chi2_sf(stat, df), 0.05, places=6)
        self.assertEqual(ml_stats.chi2_sf(0, 3), 1.0)

    def test_ols_recovers_coefficients_and_hc1_standard_errors(self):
        rng = np.random.default_rng(0)
        n = 400
        x = np.column_stack([np.ones(n), rng.normal(size=n), rng.integers(0, 2, n)])
        y = 1.0 + 2.0 * x[:, 1] - 0.5 * x[:, 2] + rng.normal(scale=0.3, size=n)
        fit = ml_stats.ols(y, x, ["const", "x", "d"])
        self.assertAlmostEqual(fit.params["x"], 2.0, delta=0.05)
        self.assertAlmostEqual(fit.params["d"], -0.5, delta=0.1)
        resid = y - x @ np.array([fit.params[n] for n in ["const", "x", "d"]])
        bread = np.linalg.inv(x.T @ x)
        manual = n / (n - 3) * bread @ (x.T * resid ** 2) @ x @ bread
        self.assertAlmostEqual(fit.se["x"], np.sqrt(manual[1, 1]), places=10)
        lo, hi = fit.summary("x")["ci"]
        self.assertLess(lo, 2.0)
        self.assertGreater(hi, 2.0)

    def test_cluster_robust_errors_exceed_naive_with_correlated_groups(self):
        rng = np.random.default_rng(1)
        groups = np.repeat(np.arange(40), 25)
        shared = rng.normal(size=40)[groups]
        x = np.column_stack([np.ones(len(groups)), shared + rng.normal(size=len(groups))])
        y = 0.5 * x[:, 1] + 2 * shared + rng.normal(size=len(groups))
        naive = ml_stats.ols(y, x, ["const", "x"])
        clustered = ml_stats.ols(y, x, ["const", "x"], groups=groups)
        self.assertGreater(clustered.se["x"], naive.se["x"])

    def test_wald_test_rejects_real_effects_and_accepts_null(self):
        rng = np.random.default_rng(2)
        n = 500
        x = np.column_stack([np.ones(n), rng.normal(size=n), rng.normal(size=n)])
        null = ml_stats.ols(rng.normal(size=n), x, ["c", "a", "b"])
        real = ml_stats.ols(x[:, 1] + rng.normal(size=n), x, ["c", "a", "b"])
        self.assertGreater(null.wald_p(["a", "b"]), 0.01)
        self.assertLess(real.wald_p(["a", "b"]), 1e-6)


if __name__ == "__main__":
    unittest.main()
