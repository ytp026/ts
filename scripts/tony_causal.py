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
NOM_PRE = (-4, -1)
NOM_PLACEBO_PRE = (-9, -6)
NOM_PLACEBO_POST = (-4, -1)
NOM_CONTROLS = ["pre_capacity", "pre_log_gross", "log_run_age"]
ELIGIBLE_WEEKS = 52
LIFECYCLE_WEEKS = 8
RUN_HORIZONS = (13, 26, 52)
KM_WEEKS = 104
GROUPS = ("notNominated", "nominatedLost", "won")
RUN_CONTROLS = ["pre_log_gross", "pre_capacity", "log_run_age"]


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


def nominated_titles(tony_rows):
    """Year -> titles with a nomination in any Tony category."""
    titles = {}
    for row in tony_rows[1:]:
        year, _, _, show, _, nominated = row[:6]
        if show and nominated:
            titles.setdefault(int(year), set()).add(show)
    return titles


def nomination_units(history, nominations, ceremonies, nominees, any_nominated):
    """New-this-season shows running in nomination week, grouped by Tony outcome.

    Groups: 'won' / 'nominatedLost' (production categories) and 'notNominated'
    (no nomination in any category). Shows nominated only in acting, design or
    other categories are left out so the comparison is clean.
    """
    units = []
    for year, (week, source) in sorted(nominations.items()):
        running = history[(history["week"] > week - pd.Timedelta(weeks=2))
                          & (history["week"] <= week)
                          & (history["run_start"] > week - pd.Timedelta(weeks=ELIGIBLE_WEEKS))]
        runs = running.sort_values("week").groupby("key").tail(1).set_index("key")
        keys = set(runs.index)
        status, category = {}, {}
        for nominee_year, title, cat, won in nominees:
            match = ml_data.match_title(title, keys) if nominee_year == year else None
            if match is not None and 1 + int(won) >= status.get(match, 0):
                status[match] = 1 + int(won)
                category[match] = cat
        other = {ml_data.match_title(t, keys) for t in any_nominated.get(year, ())} - {None}
        for show_key, run in runs.iterrows():
            level = status.get(show_key)
            if level is None and show_key in other:
                continue
            units.append({"year": year, "show": run["show"], "run_id": run["run_id"],
                          "run_start": run["run_start"], "run_end": run["run_end"],
                          "nomination": week, "nominationDate": source,
                          "ceremony": ceremonies[year],
                          "group": {None: "notNominated", 1: "nominatedLost", 2: "won"}[level],
                          "nominated": int(level is not None), "won": int(level == 2),
                          "category": category.get(show_key)})
    frame = pd.DataFrame(units)
    if not frame.empty:
        frame["unit"] = frame["year"].astype(str) + "|" + frame["run_id"]
    return frame


def nomination_panel(history, units):
    rows = history.merge(units[["run_id", "unit", "year", "nomination", "ceremony"]],
                         on="run_id")
    rows["e_nom"] = ((rows["week"] - rows["nomination"]).dt.days // 7).astype(int)
    rows["e_cer"] = ((rows["week"] - rows["ceremony"]).dt.days // 7).astype(int)
    rows["run_week"] = ((rows["week"] - rows["run_start"]).dt.days // 7).astype(int)
    rows = rows[rows["e_cer"] <= LIFECYCLE_WEEKS].copy()
    rows["log_gross"] = np.log(rows["gross"])
    return rows


def _means(rows, prefix):
    grouped = rows.groupby("unit").agg(log_gross=("log_gross", "mean"),
                                       capacity=("capacity", "mean"), n=("e_nom", "size"))
    return grouped.add_prefix(prefix)


def nomination_frame(units, panel, pre=NOM_PRE, post=None, min_weeks=2):
    """Change in mean log gross from before nomination to nomination->Tony night.

    `post=None` uses the weeks after the announcement week up to and including
    the ceremony week, so the nomination estimate never includes post-win weeks.
    """
    pre_rows = panel[panel["e_nom"].between(*pre)]
    if post is None:
        post_rows = panel[(panel["e_nom"] >= 1) & (panel["e_cer"] <= 0)]
    else:
        post_rows = panel[panel["e_nom"].between(*post)]
    frame = units.set_index("unit").join(_means(pre_rows, "pre_")).join(
        _means(post_rows, "post_"), how="inner")
    frame = frame[(frame["pre_n"] >= min_weeks) & (frame["post_n"] >= min_weeks)].copy()
    frame["d_log_gross"] = frame["post_log_gross"] - frame["pre_log_gross"]
    anchor = frame["nomination"] + pd.to_timedelta(pre[1] * 7, unit="D")
    frame["log_run_age"] = np.log1p((anchor - frame["run_start"]).dt.days / 7)
    return frame


def lifecycle(units, panel, latest, after_weeks=LIFECYCLE_WEEKS, min_weeks=2):
    """Descriptive: each show's average weekly gross in three windows, indexed so its
    own weeks before the nomination announcement = 100 (every show in the study opened
    within ELIGIBLE_WEEKS of the announcement). Groups are compared, not causally identified."""
    windows = {
        "beforeNomination": panel[panel["e_nom"] < 0],
        "afterNomination": panel[(panel["e_nom"] >= 1) & (panel["e_cer"] <= 0)],
        "afterTony": panel[(panel["e_cer"] >= 1) & (panel["e_cer"] <= after_weeks)],
    }
    means = pd.concat({name: rows.groupby("unit")["gross"].agg(["mean", "size"])
                       for name, rows in windows.items()}, axis=1)
    means.columns = [f"{name}_{stat}" for name, stat in means.columns]
    means = means[means["beforeNomination_size"] >= min_weeks]
    frame = units.set_index("unit").join(means, how="inner")
    output = {}
    for group in ("notNominated", "nominatedLost", "won"):
        part = frame[frame["group"] == group]
        row = {"shows": int(len(part)), "beforeNomination": 100.0}
        for name in ("afterNomination", "afterTony"):
            ok = part[f"{name}_size"] >= min_weeks
            index = 100 * part.loc[ok, f"{name}_mean"] / part.loc[ok, "beforeNomination_mean"]
            row[name] = ml_data.safe_float(index.median(), 1) if len(index) else None
            row[f"{name}Shows"] = int(ok.sum())
            row[f"{name}Spread"] = ({f"p{q}": ml_data.safe_float(index.quantile(q / 100), 1)
                                     for q in (10, 25, 50, 75, 90)} if len(index) else None)
        output[group] = row
    return output


def kaplan_meier(time, event, weeks=KM_WEEKS):
    """Share still running at each whole week (Kaplan-Meier, right-censored)."""
    time, event = np.asarray(time, float), np.asarray(event, bool)
    survival, curve, median = 1.0, [], None
    for week in range(weeks + 1):
        at_risk = (time >= week).sum()
        closed = (event & (time == week)).sum()
        if at_risk:
            survival *= 1 - closed / at_risk
        if median is None and survival <= 0.5:
            median = week
        curve.append(round(100 * survival, 1))
    return curve, median


def log_rank(time, event, group):
    """Log-rank chi-square test that all groups share one survival curve."""
    time, event, group = np.asarray(time, float), np.asarray(event, bool), np.asarray(group)
    labels = list(dict.fromkeys(group))
    k = len(labels)
    if k < 2:
        return None
    observed_minus_expected = np.zeros(k)
    variance = np.zeros((k, k))
    for t in np.unique(time[event]):
        risk = time >= t
        n = risk.sum()
        d = (event & (time == t)).sum()
        n_g = np.array([(risk & (group == g)).sum() for g in labels], float)
        d_g = np.array([(event & (time == t) & (group == g)).sum() for g in labels], float)
        observed_minus_expected += d_g - d * n_g / n
        if n > 1:
            share = n_g / n
            variance += d * (n - d) / (n - 1) * (np.diag(share) - np.outer(share, share))
    u, v = observed_minus_expected[:-1], variance[:-1, :-1]
    stat = float(u @ np.linalg.pinv(v) @ u)
    return ml_data.safe_float(ml_stats.chi2_sf(stat, k - 1))


def run_frame(units, panel, latest):
    """One row per show running on Tony night: weeks it kept running after Tony night."""
    pre = _means(panel[panel["e_nom"] < 0], "pre_")
    frame = units.set_index("unit").join(pre, how="inner")
    frame = frame[(frame["pre_n"] >= 2) & (frame["run_end"] >= frame["ceremony"])].copy()
    frame["closed"] = frame["run_end"] < latest - pd.Timedelta(weeks=ml_data.RUN_GAP_WEEKS)
    end = frame["run_end"].where(frame["closed"], latest)
    frame["weeks"] = (end - frame["ceremony"]).dt.days // 7
    frame["log_run_age"] = np.log1p((frame["ceremony"] - frame["run_start"]).dt.days / 7)
    frame["nominatedLost"] = (frame["group"] == "nominatedLost").astype(int)
    frame["musical"] = frame["category"].fillna("").str.contains("Musical").astype(int)
    frame["revival"] = frame["category"].fillna("").str.contains("Revival").astype(int)
    return frame


def running_regression(frame, horizon, treatments, controls):
    """Linear probability model: still running `horizon` weeks after Tony night."""
    seen = frame[frame["closed"] | (frame["weeks"] >= horizon)]
    y = (seen["weeks"] >= horizon).astype(float)
    years = pd.get_dummies(seen["year"], prefix="y", drop_first=True, dtype=float)
    x = pd.concat([seen[treatments + controls].astype(float), years], axis=1)
    x.insert(0, "const", 1.0)
    fit = ml_stats.ols(y, x.to_numpy(), x.columns)
    out = {"n": int(len(seen))}
    for name in treatments:
        term = fit.summary(name)
        out[name] = {"points": ml_data.safe_float(100 * term["coef"], 1),
                     "ci95": [ml_data.safe_float(100 * term["ci"][0], 1),
                              ml_data.safe_float(100 * term["ci"][1], 1)],
                     "pValue": ml_data.safe_float(term["p"], 4)}
    return out


def run_length(units, panel, latest):
    """How long shows keep running after Tony night, by Tony outcome."""
    frame = run_frame(units, panel, latest)
    groups = {}
    for group in GROUPS:
        part = frame[frame["group"] == group]
        curve, median = kaplan_meier(part["weeks"], part["closed"])
        groups[group] = {
            "shows": int(len(part)), "stillOpen": int((~part["closed"]).sum()),
            "medianWeeksAfterTony": median, "curve": curve,
            "stillRunning": {str(h): curve[h] for h in RUN_HORIZONS if h < len(curve)},
        }
    pair = lambda a, b: log_rank(*(frame.loc[frame["group"].isin([a, b]), c]
                                   for c in ("weeks", "closed", "group")))
    nominees = frame[frame["group"] != "notNominated"]
    plays = nominees[nominees["musical"] == 0]
    return {
        "groups": groups,
        "horizons": list(RUN_HORIZONS),
        "logRankP": {"allGroups": log_rank(frame["weeks"], frame["closed"], frame["group"]),
                     "wonVsLost": pair("won", "nominatedLost"),
                     "lostVsNotNominated": pair("nominatedLost", "notNominated")},
        "regression": {str(h): running_regression(frame, h, ["nominatedLost", "won"],
                                                  RUN_CONTROLS) for h in RUN_HORIZONS},
        "winnersVsLosers": {str(h): running_regression(nominees, h, ["won"],
                                                       RUN_CONTROLS + ["musical", "revival"])
                            for h in RUN_HORIZONS},
        "playsOnly": {str(h): running_regression(plays, h, ["won"], RUN_CONTROLS + ["revival"])
                      for h in RUN_HORIZONS},
        "method": ("Kaplan-Meier curves of weeks running after Tony night (shows still open "
                   "are censored), log-rank tests, and linear regressions of 'still running "
                   "after H weeks' on Tony outcome with pre-nomination gross and capacity, "
                   "weeks already running on Tony night and season fixed effects; HC1 CIs."),
    }


CATEGORY_GROUPS = ("production", "acting", "creative")
GENDERS = ("actor", "actress")
CREATIVE_WORDS = ("Direction", "Director", "Choreograph", "Score", "Book", "Scenic", "Costume",
                  "Lighting", "Sound", "Orchestration", "Conductor", "Lyrics", "Author")
BOX_GROUPS = (("none", "No acting nomination"), ("actorLost", "Actor nominated, lost"),
              ("actorWon", "Actor won"), ("actressLost", "Actress nominated, lost"),
              ("actressWon", "Actress won"))


def category_group(category):
    """Production (Best Musical/Play/Revival), acting, creative/design, or None (honorary)."""
    if category in ml_data.PRODUCTION_CATEGORIES:
        return "production"
    if "Actor" in category or "Actress" in category:
        return "acting"
    if any(word in category for word in CREATIVE_WORDS):
        return "creative"
    return None


def tony_flags(tony_rows):
    """(year, title) -> nom_/won_ flags for each category group and acting gender."""
    flags = {}
    for row in tony_rows[1:]:
        year, category, _, show, won, nominated = row[:6]
        group = category_group(category or "")
        if not show or not nominated or group is None:
            continue
        labels = [group] + (["actress"] if "Actress" in category else
                            ["actor"] if "Actor" in category else [])
        entry = flags.setdefault((int(year), show), {})
        for label in labels:
            entry[f"nom_{label}"] = 1
            if won:
                entry[f"won_{label}"] = 1
    return flags


def category_units(history, nominations, ceremonies, flags):
    """New-this-season shows running in nomination week with per-category Tony flags."""
    by_year, units = {}, []
    for (year, title), entry in flags.items():
        by_year.setdefault(year, []).append((title, entry))
    labels = CATEGORY_GROUPS + GENDERS
    for year, (week, _) in sorted(nominations.items()):
        running = history[(history["week"] > week - pd.Timedelta(weeks=2))
                          & (history["week"] <= week)
                          & (history["run_start"] > week - pd.Timedelta(weeks=ELIGIBLE_WEEKS))]
        runs = running.sort_values("week").groupby("key").tail(1).set_index("key")
        keys, matched = set(runs.index), {}
        for title, entry in by_year.get(year, []):
            match = ml_data.match_title(title, keys)
            if match is not None:
                target = matched.setdefault(match, {})
                for name, value in entry.items():
                    target[name] = max(target.get(name, 0), value)
        for show_key, run in runs.iterrows():
            entry = matched.get(show_key, {})
            row = {"year": year, "show": run["show"], "run_id": run["run_id"],
                   "run_start": run["run_start"], "run_end": run["run_end"],
                   "nomination": week, "ceremony": ceremonies[year],
                   "group": "", "category": ""}
            for label in labels:
                row[f"nom_{label}"] = entry.get(f"nom_{label}", 0)
                row[f"won_{label}"] = entry.get(f"won_{label}", 0)
            units.append(row)
    frame = pd.DataFrame(units)
    if not frame.empty:
        frame["unit"] = frame["year"].astype(str) + "|" + frame["run_id"]
    return frame


def tony_night_frame(units, panel, min_weeks=3):
    """Change in mean log gross, weeks 1-8 after Tony night vs weeks -7..0."""
    pre = _means(panel[panel["e_cer"].between(*PRE)], "pre_")
    post = _means(panel[panel["e_cer"].between(*POST)], "post_")
    frame = units.set_index("unit").join(pre).join(post, how="inner")
    frame = frame[(frame["pre_n"] >= min_weeks) & (frame["post_n"] >= min_weeks)].copy()
    frame["d_log_gross"] = frame["post_log_gross"] - frame["pre_log_gross"]
    frame["log_run_age"] = np.log1p((frame["ceremony"] - frame["run_start"]).dt.days / 7)
    return frame


def double_ml_multi(x, d, y, learner, folds=5, repeats=3, seed=7):
    """Cross-fitted partially linear model with several treatments: residualize y and each
    treatment column on the controls with an ML learner, then OLS (HC1) of the y residual on
    all treatment residuals. Returns per-repeat (params, cov) lists."""
    from sklearn.base import clone
    from sklearn.model_selection import KFold

    fits = []
    for r in range(repeats):
        ry, rd = np.zeros(len(y)), np.zeros(d.shape)
        for train, test in KFold(folds, shuffle=True, random_state=seed + r).split(x):
            ry[test] = y[test] - clone(learner).fit(x[train], y[train]).predict(x[test])
            for k in range(d.shape[1]):
                rd[test, k] = d[test, k] - clone(learner).fit(x[train], d[train, k]).predict(x[test])
        names = [f"t{k}" for k in range(d.shape[1])]
        fit = ml_stats.ols(ry, rd, names)
        fits.append((np.array([fit.params[n] for n in names]), np.asarray(fit.cov)))
    return fits


def _median_combine(values, variances):
    """Median aggregation across sample splits (Chernozhukov et al. 2018)."""
    values, variances = np.asarray(values), np.asarray(variances)
    mid = np.median(values)
    return mid, np.sqrt(np.median(variances + (values - mid) ** 2))


def term_effects(frame, outcome, terms, controls, scale="log", compare=(), seed=7):
    """One effect per term from (1) OLS with year fixed effects and (2) cross-fitted double
    ML with gradient-boosting nuisance models, plus pairwise difference tests for both."""
    from sklearn.ensemble import HistGradientBoostingRegressor

    years = pd.get_dummies(frame["year"], prefix="y", drop_first=True, dtype=float)
    x = pd.concat([frame[terms + controls].astype(float), years], axis=1)
    x.insert(0, "const", 1.0)
    y = frame[outcome].to_numpy(float)
    fit = ml_stats.ols(y, x.to_numpy(), x.columns)
    convert = ((lambda v: 100 * np.expm1(v)) if scale == "log" else (lambda v: 100 * v))
    unit = "percent" if scale == "log" else "points"

    def effect(coef, lo, hi, p):
        return {unit: ml_data.safe_float(convert(coef), 1),
                f"{unit}Ci95": [ml_data.safe_float(convert(lo), 1),
                                ml_data.safe_float(convert(hi), 1)],
                "pValue": ml_data.safe_float(p, 4)}

    learner = HistGradientBoostingRegressor(max_depth=3, learning_rate=0.05, max_iter=200,
                                            min_samples_leaf=10, random_state=seed)
    controls_x = pd.concat([frame[controls].astype(float), frame[["year"]].astype(float)],
                           axis=1).to_numpy()
    dml = double_ml_multi(controls_x, frame[terms].to_numpy(float), y, learner, seed=seed)
    out = {"n": int(len(frame))}
    for k, term in enumerate(terms):
        s = fit.summary(term)
        coef, se = _median_combine([p[k] for p, _ in dml], [c[k, k] for _, c in dml])
        out[term] = {**effect(s["coef"], *s["ci"], s["p"]), "shows": int(frame[term].sum()),
                     "doubleML": effect(coef, coef - 1.96 * se, coef + 1.96 * se,
                                        ml_stats.normal_p(coef / se))}
    names = list(x.columns)
    for a, b in compare:
        i, j = names.index(a), names.index(b)
        diff = fit.params[a] - fit.params[b]
        var = fit.cov[i, i] + fit.cov[j, j] - 2 * fit.cov[i, j]
        out[f"{a}_vs_{b}_p"] = ml_data.safe_float(ml_stats.normal_p(diff / np.sqrt(var)), 4)
        ki, kj = terms.index(a), terms.index(b)
        diff, sd = _median_combine([p[ki] - p[kj] for p, _ in dml],
                                   [c[ki, ki] + c[kj, kj] - 2 * c[ki, kj] for _, c in dml])
        out[f"{a}_vs_{b}_p_doubleML"] = ml_data.safe_float(ml_stats.normal_p(diff / sd), 4)
    return out


def acting_box(frame):
    """Five-number spread of each show's % change in weekly gross after Tony night."""
    pct = 100 * np.expm1(frame["d_log_gross"])
    masks = {
        "none": (frame["nom_actor"] == 0) & (frame["nom_actress"] == 0),
        "actorLost": (frame["nom_actor"] == 1) & (frame["won_actor"] == 0),
        "actorWon": frame["won_actor"] == 1,
        "actressLost": (frame["nom_actress"] == 1) & (frame["won_actress"] == 0),
        "actressWon": frame["won_actress"] == 1,
    }
    boxes = []
    for key, label in BOX_GROUPS:
        values = pct[masks[key]]
        boxes.append({"key": key, "label": label, "shows": int(len(values)),
                      **{f"p{q}": ml_data.safe_float(values.quantile(q / 100), 1)
                         for q in (10, 25, 50, 75, 90)}} if len(values) else
                     {"key": key, "label": label, "shows": 0})
    return boxes


def _five(values):
    values = pd.Series(values, dtype=float).dropna()
    if not len(values):
        return {"shows": 0}
    return {"shows": int(len(values)),
            **{f"p{q}": ml_data.safe_float(values.quantile(q / 100), 1)
               for q in (10, 25, 50, 75, 90)}}


def category_boxes(nom_frame, night, runs, cap=52):
    """Per-show spreads by category group, split into nominated vs won.

    nominationSales: % change in weekly gross, nomination -> Tony night.
    afterTonySales: % change in weekly gross, 8 weeks after vs before Tony night.
    weeksOpen: weeks a show kept running after Tony night, capped at `cap`; only shows
    whose run is fully observed up to the cap are used, so the spread isn't cut short.
    A show nominated in several groups appears in each of them."""
    def flags(frame, g):
        none = (frame[[f"nom_{k}" for k in CATEGORY_GROUPS]].sum(axis=1) == 0)
        return none, frame[f"nom_{g}"] == 1, (frame[f"nom_{g}"] == 1) & (frame[f"won_{g}"] == 0), frame[f"won_{g}"] == 1

    def build(frame, values, statuses):
        out = [{"group": "none", "status": "none", **_five(values[flags(frame, "production")[0]])}]
        for g in CATEGORY_GROUPS:
            _, nom, lost, won = flags(frame, g)
            masks = {"nominated": nom, "lost": lost, "won": won}
            out += [{"group": g, "status": s, **_five(values[masks[s]])} for s in statuses]
        return out

    observed = runs[runs["closed"] | (runs["weeks"] >= cap)]
    return {
        "nominationSales": build(nom_frame, 100 * np.expm1(nom_frame["d_log_gross"]), ["nominated"]),
        "afterTonySales": build(night, 100 * np.expm1(night["d_log_gross"]), ["lost", "won"]),
        "weeksOpen": build(observed, observed["weeks"].clip(upper=cap), ["lost", "won"]),
        "weeksCap": cap,
    }


def category_study(units, panel, latest, horizon=26):
    """Do Tony effects differ by category group (production / acting / creative) and by
    acting gender (Actor vs Actress categories)? All flags enter one regression, so each
    effect is measured with the show's other nominations and wins held equal."""
    nom_frame = nomination_frame(units, panel)
    night = tony_night_frame(units, panel)
    all_runs = run_frame(units, panel, latest)
    runs = all_runs[all_runs["closed"] | (all_runs["weeks"] >= horizon)]
    nom_terms = [f"nom_{g}" for g in CATEGORY_GROUPS]
    win_terms = [f"won_{g}" for g in CATEGORY_GROUPS]
    gender_nom = ["nom_production", "nom_creative", "nom_actor", "nom_actress"]
    gender_win = ["won_production", "won_creative", "won_actor", "won_actress"]
    pairs = lambda prefix, names: [(f"{prefix}{a}", f"{prefix}{b}")
                                   for i, a in enumerate(names) for b in names[i + 1:]]
    still = lambda frame: frame.assign(still_open=(frame["weeks"] >= horizon).astype(float))
    return {
        "question": ("Does the Tony category matter? Production awards (Best Musical, Play, "
                     "Revival), acting, and creative/design awards are compared, and acting "
                     "is split into Actor vs Actress categories."),
        "groups": {
            "production": "Best Musical, Best Play, Best Revival",
            "acting": "Lead and featured Actor/Actress, play and musical",
            "creative": ("Direction, choreography, score, book, orchestrations and "
                         "scenic/costume/lighting/sound design"),
        },
        "sample": {"shows": int(len(units)), "seasons": int(units["year"].nunique()),
                   "nominationPeriod": int(len(nom_frame)), "afterTony": int(len(night)),
                   "runLength": int(len(runs))},
        "byGroup": {
            "nominationSales": term_effects(nom_frame, "d_log_gross", nom_terms, NOM_CONTROLS,
                                            compare=pairs("nom_", CATEGORY_GROUPS)),
            "afterTonySales": term_effects(night, "d_log_gross", nom_terms + win_terms,
                                           NOM_CONTROLS, compare=pairs("won_", CATEGORY_GROUPS)),
            "stillOpen26": term_effects(still(runs), "still_open", nom_terms + win_terms,
                                        RUN_CONTROLS, scale="points",
                                        compare=pairs("won_", CATEGORY_GROUPS)),
            "boxes": category_boxes(nom_frame, night, all_runs),
        },
        "byGender": {
            "nominationSales": term_effects(nom_frame, "d_log_gross", gender_nom, NOM_CONTROLS,
                                            compare=[("nom_actor", "nom_actress")]),
            "afterTonySales": term_effects(night, "d_log_gross", gender_nom + gender_win,
                                           NOM_CONTROLS, compare=[("won_actor", "won_actress")]),
            "stillOpen26": term_effects(still(runs), "still_open", gender_nom + gender_win,
                                        RUN_CONTROLS, scale="points",
                                        compare=[("won_actor", "won_actress")]),
            "afterTonyBox": acting_box(night),
        },
        "method": ("Shows new this season and running in nomination week. Each outcome is "
                   "regressed on nominated/won flags for "
                   "every category group at once, plus pre-period gross, capacity, run age and season, "
                   "two ways: OLS with year fixed effects (HC1 CIs), and cross-fitted double "
                   "machine learning (5 folds, median of 3 splits) where gradient boosting "
                   "removes any non-linear influence of the controls from the outcome and from "
                   "each flag before the final regression. "
                   "'won_' effects are on top of being nominated in that group. Nomination "
                   "sales: 4 weeks before the announcement vs announcement to Tony night. "
                   "After-Tony sales: weeks 1-8 vs weeks -7..0. Still open: running "
                   f"{horizon} weeks after Tony night. Pairwise p-values test whether two "
                   "groups' effects differ."),
    }


def design(frame, controls=CONTROLS, treatment="won"):
    years = pd.get_dummies(frame["year"], prefix="y", drop_first=True, dtype=float)
    x = pd.concat([frame[[treatment]].astype(float), frame[controls].astype(float), years],
                  axis=1)
    x.insert(0, "const", 1.0)
    return x


def ols_effect(frame, outcome, controls=CONTROLS, bootstrap=1000, seed=7, log=False,
               treatment="won"):
    x = design(frame, controls, treatment)
    y = frame[outcome].astype(float)
    fit = ml_stats.ols(y, x.to_numpy(), x.columns).summary(treatment)
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
              "n": int(len(y)), "treated": int(frame[treatment].sum())}
    if log:
        result["percent"] = ml_data.safe_float(100 * np.expm1(coef), 2)
        result["percentCi95"] = [ml_data.safe_float(100 * np.expm1(lo), 2),
                                 ml_data.safe_float(100 * np.expm1(hi), 2)]
    return result


def _effect_row(label, coef, se, n, kind, outcome_r2=None, log=True):
    lo, hi = coef - 1.96 * se, coef + 1.96 * se
    row = {"model": label, "kind": kind, "estimate": ml_data.safe_float(coef),
           "se": ml_data.safe_float(se), "ci95": [ml_data.safe_float(lo), ml_data.safe_float(hi)],
           "pValue": ml_data.safe_float(ml_stats.normal_p(coef / se)), "n": int(n)}
    if log:
        row["percent"] = ml_data.safe_float(100 * np.expm1(coef), 2)
        row["percentCi95"] = [ml_data.safe_float(100 * np.expm1(lo), 2),
                              ml_data.safe_float(100 * np.expm1(hi), 2)]
    if outcome_r2 is not None:
        row["outcomeR2"] = ml_data.safe_float(outcome_r2, 3)
    return row


def double_selection_lasso(x, d, y, seed=7):
    """Post-double-selection lasso (Belloni, Chernozhukov & Hansen 2014)."""
    from sklearn.linear_model import LassoCV
    from sklearn.preprocessing import StandardScaler

    z = StandardScaler().fit_transform(x)
    keep = set()
    for target in (y, d):
        fit = LassoCV(cv=5, random_state=seed, max_iter=20000).fit(z, target)
        keep |= set(np.flatnonzero(np.abs(fit.coef_) > 1e-8))
    cols = sorted(keep)
    design_x = np.column_stack([np.ones(len(y)), d, x[:, cols]])
    names = ["const", "treat"] + [f"c{i}" for i in cols]
    fit = ml_stats.ols(y, design_x, names).summary("treat")
    return fit["coef"], fit["se"], len(cols)


def double_ml(x, d, y, learner, folds=5, repeats=5, seed=7):
    """Cross-fitted partialling-out DML; returns median estimate, SE and out-of-fold R2 of y."""
    from sklearn.base import clone
    from sklearn.model_selection import KFold

    thetas, ses, r2s = [], [], []
    for r in range(repeats):
        ry, rd = np.zeros(len(y)), np.zeros(len(y))
        for train, test in KFold(folds, shuffle=True, random_state=seed + r).split(x):
            ry[test] = y[test] - clone(learner).fit(x[train], y[train]).predict(x[test])
            rd[test] = d[test] - clone(learner).fit(x[train], d[train]).predict(x[test])
        theta = (rd @ ry) / (rd @ rd)
        psi = (ry - theta * rd) * rd
        thetas.append(theta)
        ses.append(np.sqrt(np.mean(psi ** 2) / np.mean(rd ** 2) ** 2 / len(y)))
        r2s.append(1 - np.mean(ry ** 2) / np.var(y))
    i = int(np.argsort(thetas)[len(thetas) // 2])
    return thetas[i], ses[i], float(np.median(r2s))


def model_comparison(frame, outcome, controls, treatment, log=True, seed=7):
    """Same effect estimated by OLS, double-selection lasso and double ML with ML nuisances."""
    from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
    from sklearn.linear_model import LinearRegression
    from sklearn.model_selection import cross_val_predict, KFold

    x_df = design(frame, controls, treatment).drop(columns=["const", treatment])
    x = x_df.to_numpy(float)
    d = frame[treatment].to_numpy(float)
    y = frame[outcome].to_numpy(float)
    n = len(y)
    ols_fit = ml_stats.ols(y, np.column_stack([np.ones(n), d, x]),
                           ["const", "treat"] + list(x_df.columns)).summary("treat")
    folds = KFold(5, shuffle=True, random_state=seed)
    linear_r2 = 1 - np.mean((y - cross_val_predict(LinearRegression(), x, y, cv=folds)) ** 2) / np.var(y)
    rows = [_effect_row("Linear regression (OLS)", ols_fit["coef"], ols_fit["se"], n,
                        "linear", linear_r2, log)]
    coef, se, kept = double_selection_lasso(x, d, y, seed)
    row = _effect_row("Lasso (double selection)", coef, se, n, "lasso", None, log)
    row["controlsKept"], row["controlsOffered"] = kept, x.shape[1]
    rows.append(row)
    learners = {
        "Gradient boosting (double ML)": HistGradientBoostingRegressor(
            max_depth=3, learning_rate=0.05, max_iter=200, min_samples_leaf=10,
            random_state=seed),
        "Random forest (double ML)": RandomForestRegressor(
            n_estimators=300, min_samples_leaf=5, random_state=seed, n_jobs=-1),
    }
    for label, learner in learners.items():
        coef, se, r2 = double_ml(x, d, y, learner, seed=seed)
        rows.append(_effect_row(label, coef, se, n, "ml", r2, log))
    return rows


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


def nomination_study(root, history, ceremonies, nominees, tony, latest, bootstrap=1000):
    verified = ml_data.load_json(root, str(ml_data.NOMINATION_DATES))["dates"]
    weeks, gap = ml_data.nomination_weeks(ceremonies, verified)
    units = nomination_units(history, weeks, ceremonies, nominees, nominated_titles(tony))
    panel = nomination_panel(history, units)
    frame = nomination_frame(units, panel)
    placebo = nomination_frame(units, panel, NOM_PLACEBO_PRE, NOM_PLACEBO_POST)
    effect = ols_effect(frame, "d_log_gross", NOM_CONTROLS, bootstrap, log=True,
                        treatment="nominated")
    checked = frame[frame["nominationDate"] == "verified"]
    cat_units = category_units(history, weeks, ceremonies, tony_flags(tony))
    return {
        "question": ("Do shows nominated for Best Musical, Play or Revival gain more between "
                     "the nomination announcement and Tony night than same-season shows "
                     "that were not nominated?"),
        "design": {
            "treated": "New-this-season productions nominated in a production category",
            "control": ("New-this-season productions running in nomination week with no "
                        "Tony nomination in any category"),
            "estimator": ("Change in mean log weekly gross from the 4 weeks before the "
                          "announcement week to the weeks after it, up to Tony night; OLS with "
                          "year fixed effects and pre-period gross, capacity and run age"),
            "placebo": "Fake announcement 5 weeks early (weeks -4..-1 vs -9..-6)",
            "dates": (f"{len(verified)} announcement dates verified from Wikipedia; other "
                      f"years assume the median gap of {gap} weeks before the ceremony week"),
            "newThisSeason": f"Run began within {ELIGIBLE_WEEKS} weeks of the announcement",
        },
        "sample": {
            "analyzed": int(len(frame)),
            "nominated": int(frame["nominated"].sum()),
            "notNominated": int((frame["nominated"] == 0).sum()),
            "seasons": int(frame["year"].nunique()),
            "verifiedDateSeasons": int(checked["year"].nunique()),
            "medianWeeksFromNominationToTony": gap,
        },
        "effects": {
            "weeklyGross": effect,
            "placeboWeeklyGross": ols_effect(placebo, "d_log_gross", NOM_CONTROLS, bootstrap,
                                             log=True, treatment="nominated"),
            "verifiedDatesOnly": ols_effect(checked, "d_log_gross", NOM_CONTROLS, bootstrap,
                                            log=True, treatment="nominated"),
        },
        "lifecycle": lifecycle(units, panel, latest),
        "runLength": run_length(units, panel, latest),
        "_frame": frame,
        "_categories": category_study(cat_units, nomination_panel(history, cat_units), latest),
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
    nomination = nomination_study(root, history, ceremonies, nominees, tony,
                                  pd.Timestamp(latest_week), bootstrap)
    categories = nomination.pop("_categories")
    comparison = {
        "won": model_comparison(did, "d_log_gross", CONTROLS, "won"),
        "wonPlacebo": model_comparison(placebo, "d_log_gross", CONTROLS, "won"),
        "nominated": model_comparison(nomination.pop("_frame"), "d_log_gross", NOM_CONTROLS,
                                      "nominated"),
        "method": ("The same before/after change is estimated four ways: OLS; post-double-"
                   "selection lasso (lasso picks controls that predict the outcome or the "
                   "treatment, then OLS on the union); and cross-fitted double machine learning "
                   "(5 folds, median of 5 splits) with gradient boosting or random forest "
                   "nuisance models, which allow non-linear control effects. outcomeR2 is the "
                   "out-of-fold R2 of the outcome on the controls alone."),
    }
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
        "nomination": nomination,
        "categories": categories,
        "modelComparison": comparison,
        "limitations": [
            "Winning is not randomly assigned; frontrunners may differ in unobserved buzz. "
            "The placebo and pre-trend tests check for diverging trends but cannot rule out "
            "all confounding, so the estimate is reported as an association.",
            "Check the reported pre-trend test and placebo confidence intervals before "
            "interpreting the post-ceremony gap; pre-existing momentum can violate "
            "the parallel-trends assumption.",
            "Nominees closed by Tony night are excluded, so the comparison concerns "
            "surviving productions rather than all nominees.",
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
    nom = results["nomination"]
    print(f"Nomination association with weekly gross: {nom['effects']['weeklyGross']['percent']}% "
          f"(95% CI {nom['effects']['weeklyGross']['percentCi95']}), n={nom['sample']['analyzed']}; "
          f"placebo {nom['effects']['placeboWeeklyGross']['percent']}%")
    print("Lifecycle medians (before nomination = 100):",
          {g: (v["afterNomination"], v["afterTony"]) for g, v in nom["lifecycle"].items()})
    for key, rows in results["modelComparison"].items():
        if key != "method":
            print(f"Model comparison ({key}):",
                  {r["model"]: (r["percent"], r["percentCi95"]) for r in rows})
    cats = results["categories"]
    for outcome, block in cats["byGroup"].items():
        if outcome == "boxes":
            continue
        print(f"Category effects ({outcome}):",
              {k: (v.get("percent", v.get("points")), v["doubleML"].get("percent",
                   v["doubleML"].get("points"))) for k, v in block.items() if isinstance(v, dict)})
    print("Actor vs actress win p (sales, still open):",
          cats["byGender"]["afterTonySales"]["won_actor_vs_won_actress_p"],
          cats["byGender"]["stillOpen26"]["won_actor_vs_won_actress_p"])
    runs = nom["runLength"]
    print("Median weeks running after Tony night:",
          {g: v["medianWeeksAfterTony"] for g, v in runs["groups"].items()},
          "log-rank p:", runs["logRankP"])
    for h, fit in runs["regression"].items():
        print(f"Still running at {h} weeks vs not nominated (pts):",
              {k: (fit[k]["points"], fit[k]["ci95"]) for k in ("nominatedLost", "won")},
              "| won vs lost:", runs["winnersVsLosers"][h]["won"]["points"],
              runs["winnersVsLosers"][h]["won"]["ci95"],
              "| plays only:", runs["playsOnly"][h]["won"]["points"], runs["playsOnly"][h]["won"]["ci95"],
              "n=", fit["n"], runs["playsOnly"][h]["n"])


if __name__ == "__main__":
    main()
