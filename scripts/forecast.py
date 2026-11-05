"""Weekly Broadway forecasting pipeline: train, evaluate, track, score and monitor.

Two gradient-boosted tree models (scikit-learn HistGradientBoosting, a
LightGBM-style histogram booster that installs on every platform) are trained
on factual weekly grosses:
  * next-week gross (log change), compared with persistence baselines (MAPE/WAPE);
  * probability that a running production closes within the next 8 weeks,
    compared with a logistic-regression baseline (ROC AUC / average precision).
Evaluation is a strict time-based holdout. Runs are tracked locally with MLflow;
the published JSON files feed the static GitHub Pages site.
"""

import argparse
import copy
import json
from pathlib import Path
import pickle
import warnings

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

try:
    from scripts import ml_data
except ImportError:  # pragma: no cover - direct script execution
    import ml_data

VALID_START = pd.Timestamp("2023-01-01")
TEST_START = pd.Timestamp("2024-01-01")
EXCLUDE = (pd.Timestamp("2020-01-01"), pd.Timestamp("2021-12-31"))
CLOSE_HORIZON = 8
SEED = 42
FEATURES = [
    "log_gross", "log_gross_l1", "log_gross_l2", "log_gross_l3", "chg_1", "chg_4",
    "roll4", "roll8", "std8", "from_peak", "capacity", "capacity_l1", "capacity_chg4",
    "avg_ticket", "log_available", "log_run_age", "target_woy", "market_log_gross",
    "market_chg_1", "shows_running", "tony_noms", "tony_wins", "weeks_since_tony",
]
CLOSE_BASELINE = ["capacity", "log_gross", "log_run_age", "chg_4"]
# Show-level features only: market_log_gross is one value per week shared by every show,
# so row-level PSI on it mostly counts weeks and seasonality. It gets market_check instead.
DRIFT_FEATURES = ["log_gross", "capacity", "avg_ticket", "chg_1", "log_run_age"]
DRIFT_NOTES = {
    "log_run_age": "Run age shifts when the slate is dominated by long-running hits or by "
                   "a wave of new openings; this is a real change in the show mix that the "
                   "model sees as an input, so it is flagged rather than suppressed.",
    "capacity": "Capacity rises in the fall and holiday season, so a moderate shift versus "
                "the prior year can be seasonal.",
}
GROSS_PARAMS = {"loss": "absolute_error", "learning_rate": 0.05, "max_leaf_nodes": 31,
                "min_samples_leaf": 80, "l2_regularization": 1.0, "random_state": SEED}
CLOSE_PARAMS = {"loss": "log_loss", "learning_rate": 0.05, "max_leaf_nodes": 15,
                "min_samples_leaf": 100, "l2_regularization": 1.0, "random_state": SEED}
ITERATIONS = (50, 100, 200, 400, 800)


def make_model(kind, iterations, warm_start=False):
    if kind == "gross":
        return HistGradientBoostingRegressor(max_iter=iterations, early_stopping=False,
                                             warm_start=warm_start, **GROSS_PARAMS)
    return HistGradientBoostingClassifier(max_iter=iterations, early_stopping=False,
                                          warm_start=warm_start, **CLOSE_PARAMS)


def predict(model, frame, features=FEATURES):
    if isinstance(model, HistGradientBoostingClassifier):
        return model.predict_proba(frame[features])[:, 1]
    return model.predict(frame[features])


def select_iterations(kind, train, valid, target, features=FEATURES):
    """Grow one booster and keep the iteration count that scores best on 2023."""
    model, best = make_model(kind, ITERATIONS[0], warm_start=True), None
    for rounds in ITERATIONS:
        model.set_params(max_iter=rounds)
        model.fit(train[features], train[target])
        pred = predict(model, valid, features)
        score = (-np.mean(np.abs(pred - valid[target])) if kind == "gross"
                 else roc_auc_score(valid[target], pred))
        if best is None or score > best[0]:
            best = (score, rounds, copy.deepcopy(model))
    return best[2], best[1]


def tony_features(frame, ceremonies, counts):
    frame["tony_noms"] = 0
    frame["tony_wins"] = 0
    frame["weeks_since_tony"] = -1.0
    for year, ceremony in sorted(ceremonies.items()):
        hits = {k: v for (y, k), v in counts.items() if y == year and v[1] > 0}
        if not hits:
            continue
        mask = (frame["key"].isin(hits) & (frame["run_start"] <= ceremony)
                & (frame["week"] > ceremony))
        frame.loc[mask, "tony_noms"] += frame.loc[mask, "key"].map(lambda k: hits[k][1])
        frame.loc[mask, "tony_wins"] += frame.loc[mask, "key"].map(lambda k: hits[k][0])
        frame.loc[mask, "weeks_since_tony"] = (frame.loc[mask, "week"] - ceremony).dt.days / 7
    return frame


def build_features(history, ceremonies=None, counts=None, latest=None):
    """One row per show-week with features known when week t is reported."""
    frame = history.sort_values(["run_id", "week"]).copy()
    frame["log_gross"] = np.log(frame["gross"])
    run = frame.groupby("run_id")
    consecutive = run["week"].diff().dt.days.eq(7)
    for lag in (1, 2, 3):
        frame[f"log_gross_l{lag}"] = run["log_gross"].shift(lag)
    frame["capacity_l1"] = run["capacity"].shift(1)
    frame["chg_1"] = (frame["log_gross"] - frame["log_gross_l1"]).where(consecutive)
    frame["chg_4"] = frame["log_gross"] - run["log_gross"].shift(4)
    frame["capacity_chg4"] = frame["capacity"] - run["capacity"].shift(4)
    frame["roll4"] = run["log_gross"].transform(lambda s: s.rolling(4, 1).mean())
    frame["roll8"] = run["log_gross"].transform(lambda s: s.rolling(8, 1).mean())
    frame["std8"] = run["log_gross"].transform(lambda s: s.rolling(8, 2).std())
    frame["from_peak"] = frame["log_gross"] - run["log_gross"].cummax()
    frame["log_available"] = np.log(frame["available"])
    frame["run_age"] = (frame["week"] - frame["run_start"]).dt.days / 7
    frame["log_run_age"] = np.log1p(frame["run_age"])
    frame["target_week"] = frame["week"] + pd.Timedelta(weeks=1)
    frame["target_woy"] = ml_data.week_of_year(frame["target_week"])
    market = frame.groupby("week").agg(market_gross=("gross", "sum"),
                                       shows_running=("show", "size"))
    market["market_log_gross"] = np.log(market["market_gross"])
    market["market_chg_1"] = market["market_log_gross"].diff().where(
        market.index.to_series().diff().dt.days.eq(7))
    frame = frame.join(market[["market_log_gross", "market_chg_1", "shows_running"]],
                       on="week")
    frame = tony_features(frame, ceremonies or {}, counts or {})
    nxt = run["week"].shift(-1)
    frame["y_gross_chg"] = (run["log_gross"].shift(-1) - frame["log_gross"]).where(
        (nxt - frame["week"]).dt.days.eq(7))
    frame["next_gross"] = run["gross"].shift(-1).where((nxt - frame["week"]).dt.days.eq(7))
    latest = pd.Timestamp(latest) if latest is not None else frame["week"].max()
    horizon = frame["week"] + pd.Timedelta(weeks=CLOSE_HORIZON)
    closes = frame["run_end"] <= horizon
    confirmed = frame["run_end"] <= latest - pd.Timedelta(weeks=ml_data.RUN_GAP_WEEKS)
    frame["y_close"] = np.where(~closes, 0.0, np.where(confirmed, 1.0, np.nan))
    excluded = (frame["week"] >= EXCLUDE[0]) & (frame["week"] <= EXCLUDE[1])
    frame.loc[excluded, ["y_gross_chg", "next_gross", "y_close"]] = np.nan
    return frame.reset_index(drop=True)


def split(frame, target):
    labeled = frame[frame[target].notna()]
    train = labeled[labeled["target_week"] < VALID_START]
    valid = labeled[(labeled["target_week"] >= VALID_START)
                    & (labeled["target_week"] < TEST_START)]
    test = labeled[labeled["target_week"] >= TEST_START]
    if target == "y_close":
        # Do not train on labels whose 8-week outcome window crosses into the holdout.
        reach = pd.Timedelta(weeks=CLOSE_HORIZON)
        train = train[train["week"] + reach < VALID_START]
        valid = valid[valid["week"] + reach < TEST_START]
    return train, valid, test


def seasonal_factors(train):
    """Average market-wide weekly log change by target week of year (baseline)."""
    return train.groupby("target_woy")["y_gross_chg"].mean()


def gross_errors(actual, predicted):
    actual, predicted = np.asarray(actual, float), np.asarray(predicted, float)
    ape = np.abs(predicted - actual) / actual
    return {"mape": ml_data.safe_float(100 * ape.mean(), 3),
            "medianApe": ml_data.safe_float(100 * np.median(ape), 3),
            "wape": ml_data.safe_float(100 * np.abs(predicted - actual).sum() / actual.sum(), 3)}


def paired_bootstrap(a, b, statistic, groups, reps=1000, seed=SEED):
    """95% CI of statistic(a) - statistic(b), resampling whole groups (weeks/shows)."""
    rng = np.random.default_rng(seed)
    codes, uniques = pd.factorize(groups)
    index = [np.flatnonzero(codes == g) for g in range(len(uniques))]
    diffs = []
    for _ in range(reps):
        rows = np.concatenate([index[g] for g in rng.integers(0, len(index), len(index))])
        try:
            diffs.append(statistic(a, rows) - statistic(b, rows))
        except ValueError:
            continue
    return [ml_data.safe_float(v, 4) for v in np.percentile(diffs, [2.5, 97.5])]


def close_baseline(train):
    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))
    rows = train[CLOSE_BASELINE].notna().all(axis=1)
    return model.fit(train.loc[rows, CLOSE_BASELINE], train.loc[rows, "y_close"])


def low_capacity_score(capacity):
    # Capacity can exceed 100% (standing room), so clip the rule to a valid probability.
    return np.clip(1 - np.asarray(capacity, dtype=float), 0.0, 1.0)


def classification_metrics(y, p):
    return {"rocAuc": ml_data.safe_float(roc_auc_score(y, p), 4),
            "averagePrecision": ml_data.safe_float(average_precision_score(y, p), 4),
            "brier": ml_data.safe_float(brier_score_loss(y, p), 5)}


def evaluate_gross(train, valid, test, features=FEATURES):
    model, rounds = select_iterations("gross", train, valid, "y_gross_chg", features)
    season = seasonal_factors(pd.concat([train, valid]))
    pred_model = np.exp(test["log_gross"] + predict(model, test, features))
    pred_persist = test["gross"].to_numpy()
    pred_season = np.exp(test["log_gross"] + test["target_woy"].map(season).fillna(0))
    actual = test["next_gross"].to_numpy()
    ape = lambda p: np.abs(p - actual) / actual
    errors = {"model": ape(pred_model.to_numpy()), "persistence": ape(pred_persist),
              "seasonalPersistence": ape(pred_season.to_numpy())}
    mean_ape = lambda values, rows: 100 * values[rows].mean()
    return {
        "model": gross_errors(actual, pred_model),
        "persistence": gross_errors(actual, pred_persist),
        "seasonalPersistence": gross_errors(actual, pred_season),
        "mapeDiffVsSeasonalCi95": paired_bootstrap(
            errors["model"], errors["seasonalPersistence"], mean_ape, test["target_week"]),
        "mapeDiffVsPersistenceCi95": paired_bootstrap(
            errors["model"], errors["persistence"], mean_ape, test["target_week"]),
        "rounds": int(rounds), "rows": int(len(test)),
    }, model, pred_model, pred_season


def evaluate_close(train, valid, test, features=FEATURES):
    model, rounds = select_iterations("close", train, valid, "y_close", features)
    baseline = close_baseline(pd.concat([train, valid]))
    p_model = predict(model, test, features)
    usable = test[CLOSE_BASELINE].notna().all(axis=1).to_numpy()
    p_base = np.full(len(test), np.nan)
    p_base[usable] = baseline.predict_proba(test.loc[usable, CLOSE_BASELINE])[:, 1]
    p_base[~usable] = np.nanmean(p_base)
    y = test["y_close"].to_numpy()
    auc = lambda p, rows: roc_auc_score(y[rows], p[rows])
    return {
        "model": classification_metrics(y, p_model),
        "logisticBaseline": classification_metrics(y, p_base),
        "lowCapacityRule": classification_metrics(y, low_capacity_score(test["capacity"])),
        "aucDiffVsLogisticCi95": paired_bootstrap(p_model, p_base, auc, test["key"]),
        "positiveRate": ml_data.safe_float(y.mean(), 4),
        "rounds": int(rounds), "rows": int(len(test)),
        "shows": int(test["key"].nunique()),
    }, model, p_model


def psi(reference, current, bins=10):
    reference = pd.Series(reference).dropna().to_numpy()
    current = pd.Series(current).dropna().to_numpy()
    if len(reference) < bins or len(current) == 0:
        return None
    edges = np.unique(np.quantile(reference, np.linspace(0, 1, bins + 1)))
    edges[0], edges[-1] = -np.inf, np.inf
    ref = np.histogram(reference, edges)[0] / len(reference)
    cur = np.histogram(current, edges)[0] / len(current)
    ref, cur = np.clip(ref, 1e-4, None), np.clip(cur, 1e-4, None)
    return ml_data.safe_float(np.sum((cur - ref) * np.log(cur / ref)), 4)


def drift_windows(reference_frame, current_frame, latest, reference_weeks=52,
                  current_weeks=8):
    """Recent, non-overlapping windows so PSI measures recent shifts, not decades of growth."""
    current_start = latest - pd.Timedelta(weeks=current_weeks)
    current = current_frame[current_frame["week"] > current_start]
    reference_end = min(reference_frame["week"].max(), current_start)
    reference_start = reference_end - pd.Timedelta(weeks=reference_weeks)
    reference = reference_frame[(reference_frame["week"] > reference_start)
                                & (reference_frame["week"] <= reference_end)]
    return reference, current, reference_start + pd.Timedelta(weeks=1), reference_end


def market_check(reference_frame, current_frame, latest, current_weeks=8):
    """Market gross in the latest weeks vs the same calendar weeks one year earlier."""
    weekly = lambda f: f.groupby("week")["market_log_gross"].first()
    current_start = latest - pd.Timedelta(weeks=current_weeks)
    current = weekly(current_frame[current_frame["week"] > current_start])
    prior_weeks = current.index - pd.Timedelta(weeks=52)
    prior = weekly(reference_frame[reference_frame["week"].isin(prior_weeks)])
    if current.empty or prior.empty:
        return {"weeks": int(len(current)), "percentChange": None, "status": "unknown"}
    change = 100 * (np.exp(current.mean() - prior.mean()) - 1)
    status = ("major" if abs(change) >= 25 else "moderate" if abs(change) >= 10
              else "stable")
    return {"weeks": int(len(current)), "priorYearWeeks": int(len(prior)),
            "percentChange": ml_data.safe_float(change, 2), "status": status}


def drift_report(reference, current):
    features = []
    for name in DRIFT_FEATURES:
        value = psi(reference[name], current[name])
        status = ("unknown" if value is None else "major" if value >= 0.25
                  else "moderate" if value >= 0.1 else "stable")
        entry = {"feature": name, "psi": value, "status": status}
        if status in ("moderate", "major") and name in DRIFT_NOTES:
            entry["note"] = DRIFT_NOTES[name]
        features.append(entry)
    return features


def update_prediction_log(log, scored, history, latest):
    """Append this week's forecasts once, then join matured forecasts to actuals."""
    entries = {(e["targetWeek"], e["show"]): e for e in log.get("entries", [])}
    for row in scored:
        ident = (row["targetWeek"], row["show"])
        if ident not in entries:
            entries[ident] = {"targetWeek": row["targetWeek"], "show": row["show"],
                              "issuedForWeek": latest, "predictedGross": row["predictedGross"],
                              "baselineGross": row["lastGross"],
                              "closeProbability": row["closeProbability"]}
    actuals = {(w.strftime("%Y-%m-%d"), s): g for w, s, g in
               history[["week", "show", "gross"]].itertuples(index=False)}
    for ident, entry in entries.items():
        if ident in actuals:
            entry["actualGross"] = actuals[ident]
    matured = [e for e in entries.values() if "actualGross" in e]
    summary = {"maturedForecasts": len(matured)}
    if matured:
        actual = [e["actualGross"] for e in matured]
        summary["modelMape"] = gross_errors(actual, [e["predictedGross"] for e in matured])["mape"]
        summary["persistenceMape"] = gross_errors(
            actual, [e["baselineGross"] for e in matured])["mape"]
    ordered = sorted(entries.values(), key=lambda e: (e["targetWeek"], e["show"]))
    return {"entries": ordered[-4000:], "summary": summary}


def series(frame, predicted, baseline):
    out = frame[["target_week", "show", "next_gross"]].copy()
    out["model"], out["baseline"] = np.asarray(predicted), np.asarray(baseline)
    market = out.groupby("target_week")[["next_gross", "model", "baseline"]].sum()
    return [{"week": w.strftime("%Y-%m-%d"), "actual": round(a), "model": round(m),
             "baseline": round(b)} for w, (a, m, b) in market.iterrows()]


def show_series(frame, predicted, shows, weeks=26):
    out = frame[["target_week", "show", "next_gross"]].copy()
    out["model"] = np.asarray(predicted)
    result = {}
    for show in shows:
        part = out[out["show"] == show].sort_values("target_week").tail(weeks)
        if len(part):
            result[show] = [[r.target_week.strftime("%Y-%m-%d"), round(r.next_gross),
                             round(r.model)] for r in part.itertuples()]
    return result


def track(root, run_name, params, metrics, artifacts):
    """Log to a local, file-based MLflow store (not committed; uploaded by Actions)."""
    try:
        import mlflow
    except ImportError:
        return None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        mlflow.set_tracking_uri((Path(root) / "mlruns").resolve().as_uri())
        mlflow.set_experiment("broadway-weekly-forecast")
        with mlflow.start_run(run_name=run_name) as run:
            mlflow.log_params(params)
            mlflow.log_metrics({k: v for k, v in metrics.items() if v is not None})
            for path in artifacts:
                mlflow.log_artifact(str(path))
            return run.info.run_id


def flatten(prefix, values):
    flat = {}
    for name, value in values.items():
        label = f"{prefix}.{name}"
        if isinstance(value, dict):
            flat.update(flatten(label, value))
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            flat[label] = float(value)
    return flat


def importance(model, frame, target, n=4000):
    """Permutation importance (drop in R^2) on a fixed test-set sample."""
    sample = frame.sample(min(n, len(frame)), random_state=SEED)
    result = permutation_importance(model, sample[FEATURES], sample[target], n_repeats=3,
                                    random_state=SEED)
    return sorted(zip(FEATURES, result.importances_mean), key=lambda x: -x[1])[:10]


# Correlated inputs are swapped together so a driver reads as one plain-English idea.
# Market-wide inputs are identical for every show in a week, so they cannot explain
# why one show is riskier than another and are left out.
DRIVER_GROUPS = {
    "size": ["log_available"],
    "age": ["log_run_age"],
    "gross": ["log_gross", "log_gross_l1", "log_gross_l2", "log_gross_l3", "roll4", "roll8"],
    "trend": ["chg_1", "chg_4", "from_peak", "std8"],
    "capacity": ["capacity", "capacity_l1", "capacity_chg4"],
    "price": ["avg_ticket"],
    "tony": ["tony_noms", "tony_wins", "weeks_since_tony"],
    "season": ["target_woy"],
}
DRIVER_MIN_POINTS = 0.02


def _money(value):
    return f"${value / 1e6:.1f}M" if value >= 1e6 else f"${value / 1e3:.0f}K"


def driver_text(group, row, typical, raises):
    """Describe one driver group for one show, comparing it with the typical running show."""
    if group == "size":
        seats, base = np.exp(row["log_available"]), np.exp(typical["log_available"])
        word = "Small" if seats < base else "Large"
        return f"{word} house: {seats / 1e3:.1f}K seats on sale a week (typical {base / 1e3:.1f}K)"
    if group == "age":
        weeks, base = row["run_age"], np.expm1(typical["log_run_age"])
        if weeks < base:
            return f"New run: {weeks:.0f} weeks in (typical {base:.0f})"
        return f"Long-running: {weeks / 52:.0f} years in" if weeks >= 104 else \
            f"Established run: {weeks:.0f} weeks in"
    if group == "gross":
        word = "Low" if row["log_gross"] < typical["log_gross"] else "Strong"
        return (f"{word} weekly gross: {_money(row['gross'])} "
                f"(typical {_money(np.exp(typical['log_gross']))})")
    if group == "trend":
        change = np.expm1(row["chg_4"]) * 100 if pd.notna(row["chg_4"]) else None
        word = "Sales trend" if change is None else ("Sales falling" if change < 0
                                                      else "Sales rising")
        return word if change is None else f"{word}: {change:+.0f}% vs 4 weeks ago"
    if group == "capacity":
        return f"{row['capacity'] * 100:.0f}% of seats filled"
    if group == "price":
        word = "Low" if row["avg_ticket"] < typical["avg_ticket"] else "High"
        return f"{word} average ticket: ${row['avg_ticket']:.0f} (typical ${typical['avg_ticket']:.0f})"
    if group == "tony":
        noms = int(row["tony_noms"])
        return "No Tony nominations" if noms == 0 else f"Tony-nominated ({noms} nominations)"
    return "Time of year: weeks ahead historically see more closings" if raises else \
        "Time of year: a historically steady stretch"


def risk_drivers(model, current, top=2, min_points=DRIVER_MIN_POINTS):
    """Top inputs pushing each show's closing risk away from the typical running show.

    For each driver group, swap that show's values for the median of all shows running
    this week and re-score. The change in probability is that group's contribution.
    Swaps are one group at a time, so contributions are not additive.
    """
    typical = current[FEATURES].median()
    base = predict(model, current)
    effects = {}
    for group, cols in DRIVER_GROUPS.items():
        swapped = current.copy()
        for col in cols:
            swapped[col] = typical[col]
        effects[group] = base - predict(model, swapped)
    drivers = []
    for i, (_, row) in enumerate(current.iterrows()):
        ranked = sorted(((effects[g][i], g) for g in DRIVER_GROUPS), reverse=True)
        raising = [(e, g) for e, g in ranked if e >= min_points][:top]
        lowering = [(e, g) for e, g in sorted(ranked) if e <= -min_points][:top]
        chosen = [(e, g, True) for e, g in raising] or [(e, g, False) for e, g in lowering]
        drivers.append([{"factor": g, "direction": "raises" if up else "lowers",
                         "points": ml_data.safe_float(e * 100, 1),
                         "text": driver_text(g, row, typical, up)}
                        for e, g, up in chosen])
    return drivers


def run(root=ml_data.ROOT, use_mlflow=True):
    """Train/evaluate on the frozen snapshot; score and monitor on live weekly data."""
    overview = ml_data.load_json(root, "broadway-overview-data.json")
    tony = ml_data.load_json(root, "tony-dashboard-data.json")["rows"]
    ceremonies, counts = ml_data.ceremony_weeks(overview), ml_data.tony_counts(tony)
    snapshot, snapshot_week = ml_data.load_snapshot(root)
    frame = build_features(snapshot, ceremonies, counts, snapshot_week)
    history, latest_week = ml_data.load_history(root)
    live = build_features(history, ceremonies, counts, latest_week)
    latest = pd.Timestamp(latest_week)

    g_train, g_valid, g_test = split(frame, "y_gross_chg")
    gross_metrics, g_model, g_pred, g_season = evaluate_gross(g_train, g_valid, g_test)
    c_train, c_valid, c_test = split(frame, "y_close")
    close_metrics, _, _ = evaluate_close(c_train, c_valid, c_test)

    # Production models: refit on every labelled snapshot week (never on live data).
    g_all = frame[frame["y_gross_chg"].notna()]
    gross_model = make_model("gross", gross_metrics["rounds"]).fit(
        g_all[FEATURES], g_all["y_gross_chg"])
    c_all = frame[frame["y_close"].notna()]
    close_model = make_model("close", close_metrics["rounds"]).fit(
        c_all[FEATURES], c_all["y_close"])
    current = live[live["week"] == latest].copy()
    current["pred_gross"] = np.exp(current["log_gross"] + predict(gross_model, current))
    current["p_close"] = predict(close_model, current)
    current["drivers"] = pd.Series(risk_drivers(close_model, current), index=current.index,
                                   dtype=object)
    target = (latest + pd.Timedelta(weeks=1)).strftime("%Y-%m-%d")
    scored = [{"show": r.show, "lastWeek": latest_week, "targetWeek": target,
               "lastGross": round(r.gross), "predictedGross": round(r.pred_gross),
               "capacity": ml_data.safe_float(r.capacity, 4),
               "closeProbability": ml_data.safe_float(r.p_close, 4),
               "riskDrivers": r.drivers}
              for r in current.sort_values("p_close", ascending=False).itertuples()]

    reference, recent, ref_start, ref_end = drift_windows(frame, live, latest)
    drift = drift_report(reference, recent)
    market = market_check(frame, live, latest)
    log_path = Path(root) / ml_data.ML_DIR / "prediction-log.json"
    log = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else {}
    log = update_prediction_log(log, scored, history, latest_week)
    backtest_mape = gross_metrics["model"]["mape"]
    live_summary = log["summary"]
    alerts = [f"{d['feature']} drift PSI {d['psi']}" for d in drift if d["status"] == "major"]
    if market["status"] == "major":
        alerts.append(f"Market gross {market['percentChange']:+}% vs same weeks last year")
    if live_summary.get("modelMape") and live_summary["maturedForecasts"] >= 30 and \
            live_summary["modelMape"] > 1.5 * backtest_mape:
        alerts.append(f"Live MAPE {live_summary['modelMape']}% exceeds 1.5x backtest "
                      f"{backtest_mape}%")

    top = importance(g_model, g_test, "y_gross_chg")
    snapshot_info = {"file": ml_data.snapshot_path(root).name, "through": snapshot_week,
                     "rows": int(len(snapshot))}
    metrics = {
        "dataThrough": latest_week,
        "trainingSnapshot": snapshot_info,
        "model": "Gradient-boosted trees (scikit-learn HistGradientBoosting)",
        "split": {"trainBefore": VALID_START.date().isoformat(),
                  "validation": f"{VALID_START.date()} to {TEST_START.date()}",
                  "testFrom": TEST_START.date().isoformat(),
                  "testThrough": snapshot_week,
                  "excludedShutdown": [EXCLUDE[0].date().isoformat(),
                                       EXCLUDE[1].date().isoformat()]},
        "nextWeekGross": gross_metrics,
        "closingWithin8Weeks": close_metrics,
        "topGrossFeatures": [{"feature": f, "importance": ml_data.safe_float(v, 4)}
                             for f, v in top],
        "features": FEATURES,
        "trainingRows": {"gross": int(len(g_all)), "closing": int(len(c_all))},
    }
    monitoring = {"dataThrough": latest_week, "drift": drift, "marketCheck": market,
                  "driftReference": (f"Last 52 snapshot (training) weeks before the current "
                                     f"window, {ref_start.date()} to {ref_end.date()}"),
                  "driftWindow": "Most recent 8 weeks of live dashboard data",
                  "trainingSnapshot": snapshot_info,
                  "liveForecasts": live_summary, "backtestMape": backtest_mape,
                  "alerts": alerts}
    shows = list(current.sort_values("gross", ascending=False)["show"])
    backtest = {"dataThrough": snapshot_week, "market": series(g_test, g_pred, g_season),
                "shows": show_series(g_test, g_pred, shows)}
    predictions = {"dataThrough": latest_week, "targetWeek": target, "predictions": scored}

    outputs = {"forecast-metrics.json": metrics, "forecast-predictions.json": predictions,
               "forecast-backtest.json": backtest, "monitoring.json": monitoring,
               "prediction-log.json": log}
    paths = [ml_data.write_json(root, name, data) for name, data in outputs.items()]
    if use_mlflow:
        model_dir = Path(root) / "mlruns" / "_models"
        model_dir.mkdir(parents=True, exist_ok=True)
        model_paths = [model_dir / "gross-model.pkl", model_dir / "close-model.pkl"]
        for path, model in zip(model_paths, (gross_model, close_model)):
            path.write_bytes(pickle.dumps(model))
        params = {**{f"gross.{k}": v for k, v in GROSS_PARAMS.items()},
                  **{f"close.{k}": v for k, v in CLOSE_PARAMS.items()},
                  "gross.max_iter": gross_metrics["rounds"],
                  "close.max_iter": close_metrics["rounds"],
                  "snapshot": snapshot_info["file"], "data_through": latest_week,
                  "features": len(FEATURES)}
        run_id = track(root, f"weekly-{latest_week}", params,
                       {**flatten("gross", gross_metrics), **flatten("close", close_metrics)},
                       paths[:4] + model_paths)
        if run_id:
            metrics["mlflowRunId"] = run_id
            ml_data.write_json(root, "forecast-metrics.json", metrics)
    return metrics, monitoring


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ml_data.ROOT)
    parser.add_argument("--no-mlflow", action="store_true")
    args = parser.parse_args()
    metrics, monitoring = run(args.root, not args.no_mlflow)
    gross, close = metrics["nextWeekGross"], metrics["closingWithin8Weeks"]
    print(f"Next-week gross MAPE: model {gross['model']['mape']}% vs persistence "
          f"{gross['persistence']['mape']}% vs seasonal {gross['seasonalPersistence']['mape']}%")
    print(f"Closing within 8 weeks AUC: model {close['model']['rocAuc']} vs logistic "
          f"{close['logisticBaseline']['rocAuc']}")
    print("Drift PSI: " + ", ".join(f"{d['feature']} {d['psi']} ({d['status']})"
                                    for d in monitoring["drift"]))
    market = monitoring["marketCheck"]
    print(f"Market gross vs same weeks last year: {market['percentChange']}% "
          f"({market['status']})")
    print(f"Monitoring alerts: {monitoring['alerts'] or 'none'}")


if __name__ == "__main__":
    main()
