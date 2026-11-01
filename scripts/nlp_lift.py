"""Does Wikipedia review sentiment improve Broadway forecasts? An honest lift test.

Both models use the same rows (show-weeks of productions with a scored Wikipedia
reception section), the same time split as forecast.py and the same gradient
boosting setup. The only difference is three sentiment features. Lift is the
test-set difference with a paired bootstrap 95% CI (closing: resampling shows;
gross: resampling weeks). Small or zero lift is reported as is.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

try:
    from scripts import forecast, ml_data
except ImportError:  # pragma: no cover - direct script execution
    import forecast
    import ml_data

SENTIMENT = ["sent_compound", "sent_positive", "sent_negative"]


def attach_sentiment(frame, sentiment):
    scores = pd.DataFrame([{"key": k, "sent_compound": v["compoundMean"],
                            "sent_positive": v["positiveShare"],
                            "sent_negative": v["negativeShare"]}
                           for k, v in sentiment["shows"].items()])
    if scores.empty:
        return frame.iloc[0:0].assign(**{c: [] for c in SENTIMENT})
    return frame.merge(scores, on="key", how="inner")


def compare_close(train, valid, test):
    results, preds = {}, {}
    for label, features in (("numericOnly", forecast.FEATURES),
                            ("withSentiment", forecast.FEATURES + SENTIMENT)):
        model, rounds = forecast.select_iterations("close", train, valid, "y_close", features)
        preds[label] = forecast.predict(model, test, features)
        results[label] = {**forecast.classification_metrics(test["y_close"], preds[label]),
                          "rounds": int(rounds)}
    y = test["y_close"].to_numpy()
    auc = lambda p, rows: roc_auc_score(y[rows], p[rows])
    lift = results["withSentiment"]["rocAuc"] - results["numericOnly"]["rocAuc"]
    results["aucLift"] = ml_data.safe_float(lift, 4)
    results["aucLiftCi95"] = forecast.paired_bootstrap(
        preds["withSentiment"], preds["numericOnly"], auc, test["key"])
    results.update(rows=int(len(test)), shows=int(test["key"].nunique()),
                   positiveRate=ml_data.safe_float(y.mean(), 4))
    return results


def compare_gross(train, valid, test):
    results, errors = {}, {}
    actual = test["next_gross"].to_numpy()
    for label, features in (("numericOnly", forecast.FEATURES),
                            ("withSentiment", forecast.FEATURES + SENTIMENT)):
        model, rounds = forecast.select_iterations("gross", train, valid, "y_gross_chg",
                                                   features)
        pred = np.exp(test["log_gross"].to_numpy() + forecast.predict(model, test, features))
        errors[label] = np.abs(pred - actual) / actual
        results[label] = {**forecast.gross_errors(actual, pred), "rounds": int(rounds)}
    mean_ape = lambda values, rows: 100 * values[rows].mean()
    results["mapeChange"] = ml_data.safe_float(
        results["withSentiment"]["mape"] - results["numericOnly"]["mape"], 3)
    results["mapeChangeCi95"] = forecast.paired_bootstrap(
        errors["withSentiment"], errors["numericOnly"], mean_ape, test["target_week"])
    results.update(rows=int(len(test)), shows=int(test["key"].nunique()))
    return results


def analyze(root=ml_data.ROOT):
    sentiment = json.loads((Path(root) / "ml" / "review-sentiment.json").read_text(
        encoding="utf-8"))
    overview = ml_data.load_json(root, "broadway-overview-data.json")
    tony = ml_data.load_json(root, "tony-dashboard-data.json")["rows"]
    snapshot, snapshot_week = ml_data.load_snapshot(root)
    frame = forecast.build_features(snapshot, ml_data.ceremony_weeks(overview),
                                    ml_data.tony_counts(tony), snapshot_week)
    joined = attach_sentiment(frame, sentiment)
    recent = frame[frame["week"] >= pd.Timestamp("1996-01-01")]
    close = compare_close(*forecast.split(joined, "y_close"))
    gross = compare_gross(*forecast.split(joined, "y_gross_chg"))
    return {
        "dataThrough": snapshot_week,
        "trainingSnapshot": ml_data.snapshot_path(root).name,
        "question": ("Do sentiment scores from Wikipedia critical-reception sections improve "
                     "closing-risk and next-week gross forecasts over numeric features alone?"),
        "method": sentiment["method"],
        "sentimentFeatures": SENTIMENT,
        "coverage": {
            "showsSince1996": int(recent["key"].nunique()),
            "showsWithSentiment": int(joined["key"].nunique()),
            "showWeekShare": ml_data.safe_float(
                (joined["week"] >= pd.Timestamp("1996-01-01")).sum() / max(len(recent), 1), 4),
        },
        "closingWithin8Weeks": close,
        "nextWeekGross": gross,
        "attribution": sentiment["attribution"],
        "limitations": [
            "Wikipedia reception sections are written or edited after opening, often after "
            "a run ends, so even with outcome sentences removed the text may reflect hindsight "
            "(look-ahead leakage). Any lift is an upper bound on what opening-night reviews "
            "would provide.",
            "Only shows with a matched English Wikipedia article and a reception section are "
            "included, which over-represents notable productions.",
            "Sentiment is a static per-show score; it cannot explain week-to-week changes.",
            "VADER is a general-purpose lexicon, not tuned to theatre criticism.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ml_data.ROOT)
    args = parser.parse_args()
    result = analyze(args.root)
    ml_data.write_json(args.root, "nlp-lift.json", result)
    close, gross = result["closingWithin8Weeks"], result["nextWeekGross"]
    print(f"Closing AUC: numeric {close['numericOnly']['rocAuc']} vs +sentiment "
          f"{close['withSentiment']['rocAuc']} (lift {close['aucLift']}, "
          f"95% CI {close['aucLiftCi95']})")
    print(f"Gross MAPE: numeric {gross['numericOnly']['mape']}% vs +sentiment "
          f"{gross['withSentiment']['mape']}% (change {gross['mapeChange']}, "
          f"95% CI {gross['mapeChangeCi95']})")


if __name__ == "__main__":
    main()
