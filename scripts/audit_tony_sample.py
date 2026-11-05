"""Export counts at each Tony study filter, without refitting models."""

import json
from pathlib import Path

import ml_data
import tony_causal as study


def audit(root=ml_data.ROOT):
    history, latest = ml_data.load_snapshot(root)
    rows = ml_data.load_json(root, "tony-dashboard-data.json")["rows"]
    ceremonies = ml_data.ceremony_weeks(ml_data.load_json(root, "broadway-overview-data.json"))
    nominees = ml_data.production_nominees(rows)
    eligible = [r for r in nominees if r[0] in ceremonies]
    units = study.build_units(history, ceremonies, nominees)
    frame = study.did_frame(units, study.event_panel(history, units))
    dates = ml_data.load_json(root, str(ml_data.NOMINATION_DATES))["dates"]
    weeks, _ = ml_data.nomination_weeks(ceremonies, dates)
    nomination_units = study.nomination_units(history, weeks, ceremonies, nominees,
                                              study.nominated_titles(rows))
    panel = study.nomination_panel(history, nomination_units)
    lifecycle = study.lifecycle(nomination_units, panel, latest)
    counts = lambda values: {"winners": int(sum(values)),
                             "nonWinningNominees": int(len(values) - sum(values))}
    result = {
        "dataThrough": latest,
        "productionAwardRecordsInCoveredCeremonies": counts([r[3] for r in eligible]),
        "matchedProductionsRunningNearTonyNight": counts(units["won"]),
        "withAtLeastThreePreAndPostWeeks": counts(frame["won"]),
        "lifecycleRecordsWithAtLeastTwoPreNominationWeeks": {
            k: v["shows"] for k, v in lifecycle.items()},
        "definitions": [
            "Source counts are category-year-title nominations, including winners.",
            "Matched counts deduplicate each production run within each season.",
            "Lifecycle includes productions opened within 52 weeks and running near nomination day.",
            "Lifecycle excludes acting/design-only nominees and requires two pre-nomination gross weeks.",
            "Win comparison requires a match near Tony night and three weeks of gross on each side.",
            "Historical combined Revival and official ties are retained; do not enforce exactly four winners every year.",
        ],
    }
    path = Path(root) / "data" / "tony-sample-audit.json"
    path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    audit()
