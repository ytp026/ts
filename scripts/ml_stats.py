"""Small, dependency-light OLS inference (HC1 and cluster-robust) used by the causal study.

Implemented with numpy only so the analysis runs on every platform, including
Windows ARM64 where statsmodels wheels are unavailable.
"""

import math

import numpy as np

Z95 = 1.959963984540054


def normal_p(z):
    return math.erfc(abs(z) / math.sqrt(2))


def chi2_sf(x, k):
    """Exact chi-square survival function for integer degrees of freedom."""
    if x <= 0:
        return 1.0
    half = x / 2
    if k % 2 == 0:
        term, total = 1.0, 1.0
        for i in range(1, k // 2):
            term *= half / i
            total += term
        return min(1.0, math.exp(-half) * total)
    total = math.erfc(math.sqrt(half))
    term = math.sqrt(half) / math.gamma(1.5)
    for i in range(1, (k + 1) // 2):
        total += math.exp(-half) * term
        term *= half / (i + 0.5)
    return min(1.0, total)


class OLSResult:
    def __init__(self, names, params, cov):
        self.names = list(names)
        self.params = dict(zip(self.names, params))
        self.cov = cov
        self.se = dict(zip(self.names, np.sqrt(np.clip(np.diag(cov), 0, None))))

    def summary(self, name):
        coef, se = self.params[name], self.se[name]
        z = coef / se if se > 0 else float("nan")
        return {"coef": float(coef), "se": float(se),
                "ci": (float(coef - Z95 * se), float(coef + Z95 * se)),
                "p": normal_p(z) if se > 0 else float("nan")}

    def wald_p(self, names):
        idx = [self.names.index(n) for n in names]
        beta = np.array([self.params[n] for n in names])
        cov = self.cov[np.ix_(idx, idx)]
        stat = float(beta @ np.linalg.pinv(cov) @ beta)
        return chi2_sf(stat, len(names))


def ols(y, x, names, groups=None):
    """OLS with HC1 (default) or cluster-robust (CR1) covariance."""
    y, x = np.asarray(y, float), np.asarray(x, float)
    xtx_inv = np.linalg.pinv(x.T @ x)
    beta = xtx_inv @ x.T @ y
    resid = y - x @ beta
    n, rank = len(y), np.linalg.matrix_rank(x)
    if groups is None:
        meat = (x * resid[:, None] ** 2).T @ x
        scale = n / max(n - rank, 1)
    else:
        codes = np.unique(np.asarray(groups), return_inverse=True)[1]
        scores = np.zeros((codes.max() + 1, x.shape[1]))
        np.add.at(scores, codes, x * resid[:, None])
        meat = scores.T @ scores
        g = len(scores)
        scale = g / max(g - 1, 1) * (n - 1) / max(n - rank, 1)
    return OLSResult(names, beta, scale * xtx_inv @ meat @ xtx_inv)
