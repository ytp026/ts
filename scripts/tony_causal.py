"""Causal estimate of winning a Tony production award on weekly Broadway box office.

Design: among productions nominated for Best Musical / Play / Revival that were
running on Tony night, compare winners with same-year nominees that lost
(difference-in-differences). Same-year comparisons share the calendar, so year
fixed effects absorb seasonality and market-wide shocks; show-mix controls
cover musical/play, revival status, pre-ceremony demand, capacity and run age.
An event study checks pre-trends and a placebo ceremony is placed 8 weeks early.
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

try:
    from scripts import ml_data, ml_stats
except ImportError:  # pragma: no cover - direct script execution
    import ml_data
    import ml_stats

PRE = (-7, 0)
POST = (1, 8)
PLACEBO_PRE = (-15, -8)
PLACEBO_POST = (-7, 0)
EVENT = (-8, 12)
SURVIVAL_WEEKS = 26
CONTROLS = ["musical", "revival", "pre_capacity", "pre_log_gross", "log_run_age"]


def build_units(history, ceremonies, nominees):
    units = []
    for year, title, category, won in nominees:
        ceremony = ceremonies.get(year)
        if ceremony is None:
            continue
        window = history[(history["week"] > ceremony - pd.Timedelta(weeks=4))
                         & (history["week"] <= ceremony)]
        match = ml_data.match_title(title, set(window["key"]))
        if match is None:
            continue
        run = window[window["key"] == match].sort_values("week").iloc[-1]
        units.append({"year": year, "title": title, "category": category, "won": won,
                      "show": run["show"], "run_id": run["run_id"], "ceremony": ceremony,
                      "run_start": run["run_start"], "run_end": run["run_end"]})
    frame = pd.DataFrame(units)
    if frame.empty:
        return frame
    frame = (frame.sort_values("won", ascending=False)
             .drop_duplicates(["year", "run_id"]).reset_index(drop=True))
    frame["musical"] = frame["category"].str.contains("Musical").astype(int)
    frame["revival"] = frame["category"].str.contains("Revival").astype(int)
    frame["unit"] = frame["year"].astype(str) + "|" + frame["run_id"]
    return frame


def event_panel(history, units, span=(-16, SURVIVAL_WEEKS)):
    rows = history.merge(units[["run_id", "unit", "ceremony", "year", "won"]], on="run_id")
    rows["e"] = ((rows["week"] - rows["ceremony"]).dt.days // 7).astype(int)
    rows = rows[(rows["e"] >= span[0]) & (rows["e"] <= span[1])].copy()
    rows["log_gross"] = np.log(rows["gross"])
    return rows


def window_means(panel, lo, hi, prefix):
    part = panel[(panel["e"] >= lo) & (panel["e"] <= hi)]
    grouped = part.groupby("unit").agg(log_gross=("log_gross", "mean"),
                                       capacity=("capacity", "mean"),
                                       n=("e", "size"))
    return grouped.add_prefix(prefix)


def did_frame(units, panel, pre=PRE, post=POST, min_weeks=3):
    frame = units.set_index("unit").join(window_means(panel, *pre, "pre_")).join(
        window_means(panel, *post, "post_"), how="inner")
    frame = frame[(frame["pre_n"] >= min_weeks) & (frame["post_n"] >= min_weeks)].copy()
    frame["d_log_gross"] = frame["post_log_gross"] - frame["pre_log_gross"]
    frame["d_capacity_pts"] = 100 * (frame["post_capacity"] - frame["pre_capacity"])
    anchor = frame["ceremony"] + pd.to_timedelta(pre[1] * 7, unit="D")
    frame["log_run_age"] = np.log1p((anchor - frame["run_start"]).dt.days / 7)
    return frame


def design(frame, controls=CONTROLS):
    years = pd.get_dummies(frame["year"], prefix="y", drop_first=True, dtype=float)
    x = pd.concat([frame[["won"]].astype(float), frame[controls].astype(float), years], axis=1)
    x.insert(0, "const", 1.0)
    return x


def ols_effect(frame, outcome, controls=CONTROLS, bootstrap=1000, seed=7, log=False):
    x = design(frame, controls)
    y = frame[outcome].astype(float)
    fit = ml_stats.ols(y, x.to_numpy(), x.columns).summary("won")
    coef, se, (lo, hi) = fit["coef"], fit["se"], fit["ci"]
    rng = np.random.default_rng(seed)
    draws = []
    xv, yv = x.to_numpy(), y.to_numpy()
    for _ in range(bootstrap):
        idx = rng.integers(0, len(yv), len(yv))
        if xv[idx, 1].min() == xv[idx, 1].max():
            continue
        draws.append(np.linalg.lstsq(xv[idx], yv[idx], rcond=None)[0][1])
    blo, bhi = np.percentile(draws, [2.5, 97.5]) if draws else (np.nan, np.nan)
    result = {"estimate": ml_data.safe_float(coef), "se": ml_data.safe_float(se),
              "ci95": [ml_data.safe_float(lo), ml_data.safe_float(hi)],
              "bootstrapCi95": [ml_data.safe_float(blo), ml_data.safe_float(bhi)],
              "pValue": ml_data.safe_float(fit["p"]),
              "n": int(len(y)), "treated": int(frame["won"].sum())}
    if log:
        result["percent"] = ml_data.safe_float(100 * np.expm1(coef), 2)
        result["percentCi95"] = [ml_data.safe_float(100 * np.expm1(lo), 2),
                                 ml_data.safe_float(100 * np.expm1(hi), 2)]
    return result


def event_study(panel, units, window=EVENT, reference=0):
    keep = set(units.index)
    rows = panel[panel["unit"].isin(keep) & (panel["e"] >= window[0])
                 & (panel["e"] <= window[1])].copy()
    unit_fe = pd.get_dummies(rows["unit"], prefix="u", dtype=float)
    year_e = pd.get_dummies(rows["year"].astype(str) + "_" + rows["e"].astype(str),
                            prefix="ye", drop_first=True, dtype=float)
    events = [e for e in range(window[0], window[1] + 1) if e != reference]
    treat = pd.DataFrame({f"w{e}": ((rows["e"] == e) & (rows["won"] == 1)).astype(float)
                          for e in events}, index=rows.index)
    x = pd.concat([treat, unit_fe, year_e], axis=1)
    fit = ml_stats.ols(rows["log_gross"], x.to_numpy(), x.columns, groups=rows["unit"])
    output = []
    for e in range(window[0], window[1] + 1):
        if e == reference:
            output.append({"week": e, "estimate": 0.0, "ci95": [0.0, 0.0]})
            continue
        term = fit.summary(f"w{e}")
        output.append({"week": e, "estimate": ml_data.safe_float(term["coef"]),
                       "ci95": [ml_data.safe_float(term["ci"][0]),
                                ml_data.safe_float(term["ci"][1])]})
    pretrend = fit.wald_p([f"w{e}" for e in events if e < reference])
    return output, ml_data.safe_float(pretrend), int(rows["unit"].nunique())


def survival(units, latest, weeks=SURVIVAL_WEEKS):
    horizon = units["ceremony"] + pd.Timedelta(weeks=weeks)
    frame = units[horizon <= latest - pd.Timedelta(weeks=ml_data.RUN_GAP_WEEKS)].copy()
    frame["closed"] = (frame["run_end"] <= frame["ceremony"]
                       + pd.Timedelta(weeks=weeks)).astype(float)
    return frame


def interpretation(gross, placebo, pretrend_p, events):
    pre = [e["estimate"] for e in events if -4 <= e["week"] <= -1]
    post = [e["estimate"] for e in events if 1 <= e["week"] <= 8]
    pre_pct = 100 * np.expm1(np.mean(pre)) if pre else np.nan
    post_pct = 100 * np.expm1(np.mean(post)) if post else np.nan
    ci = placebo["percentCi95"]
    placebo_null = None not in ci and ci[0] <= 0 <= ci[1]
    checks_pass = placebo_null and pretrend_p is not None and pretrend_p >= 0.05
    fmt = lambda v, spec: "n/a" if v is None or not np.isfinite(v) else format(v, spec)
    if np.isfinite(pre_pct) and pre_pct < -1:
        pre_text = ("winners' grosses were already rising relative to losing nominees in the "
                    f"four weeks before the ceremony (about {abs(pre_pct):.0f}% below their "
                    "week-0 level)")
    elif np.isfinite(pre_pct) and pre_pct > 1:
        pre_text = ("winners' grosses were falling relative to losing nominees in the four "
                    f"weeks before the ceremony (about {pre_pct:.0f}% above their week-0 level)")
    else:
        pre_text = ("winners' grosses were roughly flat relative to losing nominees in the "
                    "four weeks before the ceremony")
    return {
        "label": "association",
        "checksPass": bool(checks_pass),
        "preWeeksMeanPercent": ml_data.safe_float(pre_pct, 2),
        "postWeeksMeanPercent": ml_data.safe_float(post_pct, 2),
        "summary": (
            f"Winning is associated with {fmt(gross['percent'], '.1f')}% higher weekly gross "
            f"in weeks 1-8 (95% CI {fmt(gross['percentCi95'][0], '.1f')}% to "
            f"{fmt(gross['percentCi95'][1], '.1f')}%) relative to same-season losing nominees. "
            f"Pre-trend joint test p = {fmt(pretrend_p, '.2f')}; placebo ceremony "
            f"{fmt(placebo['percent'], '+.1f')}% (95% CI {fmt(placebo['percentCi95'][0], '.1f')}% "
            f"to {fmt(placebo['percentCi95'][1], '.1f')}%). "
            + ("These checks are consistent with a causal effect under parallel trends, "
               if checks_pass else "The design checks do not fully support a causal reading, ")
            + f"but {pre_text}, and winners are often the frontrunners, so this is reported "
            "as an association, not a clean causal estimate."),
    }


def analyze(root=ml_data.ROOT, bootstrap=1000):
    history, latest_week = ml_data.load_snapshot(root)
    overview = ml_data.load_json(root, "broadway-overview-data.json")
    tony = ml_data.load_json(root, "tony-dashboard-data.json")["rows"]
    ceremonies = ml_data.ceremony_weeks(overview)
    nominees = ml_data.production_nominees(tony)
    eligible = [n for n in nominees if n[0] in ceremonies]
    units = build_units(history, ceremonies, nominees)
    panel = event_panel(history, units)
    did = did_frame(units, panel)
    placebo = did_frame(units, panel, PLACEBO_PRE, PLACEBO_POST)
    events, pretrend_p, event_units = event_study(panel, did)
    surv = survival(did.reset_index(), pd.Timestamp(latest_week))
    surv_fit = ols_effect(surv, "closed", CONTROLS, bootstrap)
    raw = did.groupby("won")[["d_log_gross", "d_capacity_pts"]].mean()
    by_type = {}
    for label, subset in (("musicals", did[did["musical"] == 1]),
                          ("plays", did[did["musical"] == 0])):
        by_type[label] = ols_effect(subset, "d_log_gross",
                                    [c for c in CONTROLS if c != "musical"], bootstrap, log=True)
    gross_fit = ols_effect(did, "d_log_gross", CONTROLS, bootstrap, log=True)
    placebo_fit = ols_effect(placebo, "d_log_gross", CONTROLS, bootstrap, log=True)
    return {
        "dataThrough": latest_week,
        "trainingSnapshot": ml_data.snapshot_path(root).name,
        "question": ("How much does winning a Tony production award (Best Musical, Play "
                     "or Revival) change weekly gross, versus nominees that lost?"),
        "interpretation": interpretation(gross_fit, placebo_fit, pretrend_p, events),
        "design": {
            "treated": "Production-category Tony winners running on Tony night",
            "control": "Same-year, same-award-season nominees that lost and were running",
            "estimator": ("Difference-in-differences on mean log weekly gross, weeks 1-8 after "
                          "vs weeks -7..0 (ceremony week = 0), OLS with year fixed effects "
                          "and show-mix controls; HC1 robust and unit-bootstrap 95% CIs"),
            "controls": CONTROLS + ["year fixed effects (seasonality, market shocks)"],
            "eventStudy": ("Unit fixed effects + year-by-event-week fixed effects; standard "
                           "errors clustered by production; reference week 0"),
            "placebo": "Fake ceremony 8 weeks early (weeks -7..0 vs -15..-8)",
        },
        "sample": {
            "productionNominationsSince1986": len(eligible),
            "matchedRunningOnTonyNight": int(len(units)),
            "analyzed": int(len(did)),
            "winners": int(did["won"].sum()),
            "losingNominees": int((did["won"] == 0).sum()),
            "ceremonies": int(did["year"].nunique()),
            "firstCeremony": int(did["year"].min()),
            "lastCeremony": int(did["year"].max()),
        },
        "rawDifferenceInDifferences": {
            "winnersLogGrossChange": ml_data.safe_float(raw.loc[1, "d_log_gross"]),
            "losersLogGrossChange": ml_data.safe_float(raw.loc[0, "d_log_gross"]),
        },
        "effects": {
            "weeklyGross": gross_fit,
            "capacityPoints": ols_effect(did, "d_capacity_pts", CONTROLS, bootstrap),
            "closedWithin26Weeks": surv_fit,
            "placeboWeeklyGross": placebo_fit,
            "byType": by_type,
        },
        "eventStudy": {"outcome": "log weekly gross", "units": event_units,
                       "preTrendJointPValue": pretrend_p, "coefficients": events},
        "limitations": [
            "Winning is not randomly assigned; frontrunners may differ in unobserved buzz. "
            "The placebo and pre-trend tests check for diverging trends but cannot rule out "
            "all confounding, so the estimate is reported as an association.",
            "Event-study pre-period coefficients are jointly insignificant but mostly "
            "negative, meaning winners were already gaining slightly before the ceremony; "
            "part of the post-ceremony gap may be pre-existing momentum.",
            "Many losing nominees had already closed by Tony night, so the control group is "
            "smaller and made of surviving productions.",
            "Gross is only observed while a show runs; losers that close drop out, which "
            "likely biases the gross effect toward zero. Closure is analyzed separately.",
            "Nominees that closed before Tony night, and titles that could not be matched "
            "unambiguously to the weekly grosses, are excluded.",
            "Gross is box-office revenue, not profit.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ml_data.ROOT)
    parser.add_argument("--bootstrap", type=int, default=1000)
    args = parser.parse_args()
    results = analyze(args.root, args.bootstrap)
    ml_data.write_json(args.root, "tony-causal-results.json", results)
    gross = results["effects"]["weeklyGross"]
    print(f"Tony win association with weekly gross: {gross['percent']}% "
          f"(95% CI {gross['percentCi95']}), n={gross['n']}")
    print(results["interpretation"]["summary"])


if __name__ == "__main__":
    main()
