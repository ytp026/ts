"""Shared loaders for the Broadway ML studies (causal, forecasting and NLP).

Only factual weekly box-office figures from the committed site datasets are used.
"""

import json
from pathlib import Path
import re
import unicodedata

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
ML_DIR = "ml"
# Broadway was dark from 2020-03-12 until 2021-09; runs that resumed are one run.
SHUTDOWN_START = pd.Timestamp("2020-03-15")
SHUTDOWN_END = pd.Timestamp("2021-09-30")
RUN_GAP_WEEKS = 13
PRODUCTION_CATEGORIES = {"Musical", "Play", "Revival of a Musical",
                         "Revival of a Play", "Revival"}


def key(value):
    return "".join(c for c in unicodedata.normalize("NFKD", str(value)).casefold()
                   if c.isalnum())


def load_json(root, name):
    return json.loads((Path(root) / name).read_text(encoding="utf-8"))


def write_json(root, name, data):
    path = Path(root) / ML_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=True, indent=1, allow_nan=False) + "\n",
                    encoding="utf-8")
    return path


def history_frame(rows):
    """Weekly show rows -> one row per (week, show) with capacity and run ids."""
    frame = pd.DataFrame(rows, columns=["week", "year", "show", "gross", "sold",
                                        "available", "avg_ticket", "records"])
    frame["week"] = pd.to_datetime(frame["week"])
    frame = (frame.groupby(["week", "show"], as_index=False)
             .agg(gross=("gross", "sum"), sold=("sold", "sum"),
                  available=("available", "sum")))
    frame = frame[(frame["gross"] > 0) & (frame["available"] > 0)].copy()
    frame["capacity"] = (frame["sold"] / frame["available"]).clip(upper=1.5)
    frame["avg_ticket"] = frame["gross"] / frame["sold"].where(frame["sold"] > 0)
    frame["key"] = frame["show"].map(key)
    return assign_runs(frame)


def assign_runs(frame):
    frame = frame.sort_values(["key", "week"]).reset_index(drop=True)
    previous = frame.groupby("key")["week"].shift()
    gap_weeks = (frame["week"] - previous).dt.days / 7
    bridges_shutdown = (previous <= SHUTDOWN_START) & (frame["week"] >= SHUTDOWN_START) & (
        frame["week"] <= SHUTDOWN_END + pd.Timedelta(weeks=RUN_GAP_WEEKS))
    new_run = previous.isna() | ((gap_weeks > RUN_GAP_WEEKS) & ~bridges_shutdown)
    frame["run"] = new_run.groupby(frame["key"]).cumsum().astype(int)
    frame["run_id"] = frame["key"] + "#" + frame["run"].astype(str)
    frame["run_start"] = frame.groupby("run_id")["week"].transform("min")
    frame["run_end"] = frame.groupby("run_id")["week"].transform("max")
    return frame


def load_history(root=ROOT):
    """Live dashboard data: used for scoring and monitoring only, never training."""
    data = load_json(root, "history-dashboard-data.json")
    return history_frame(data["rows"]), data.get("latestWeek")


SNAPSHOT_DIR = Path("data") / "snapshots"
SNAPSHOT_COLUMNS = ["week", "show", "gross", "seats_sold", "seats_available",
                    "capacity", "avg_ticket"]


def snapshot_path(root=ROOT):
    """The frozen modeling snapshot named in data/snapshots/CURRENT."""
    pointer = Path(root) / SNAPSHOT_DIR / "CURRENT"
    return Path(root) / SNAPSHOT_DIR / pointer.read_text(encoding="utf-8").strip()


def load_snapshot(root=ROOT):
    """Frozen numeric snapshot used to train and evaluate every model."""
    path = snapshot_path(root)
    raw = pd.read_csv(path, dtype={"show": str})
    rows = [[w, w[:4], s, g, sold, avail, t, 1] for w, s, g, sold, avail, t in
            raw[["week", "show", "gross", "seats_sold", "seats_available",
                 "avg_ticket"]].itertuples(index=False, name=None)]
    return history_frame(rows), raw["week"].max()


def ceremony_weeks(overview):
    """Week ending on Tony night = last week of the exported 'before' window."""
    weeks = {}
    for production in overview["productions"]:
        for entry in production["periods"]["before"]:
            year = entry["week"][:4]
            weeks[year] = max(weeks.get(year, ""), entry["week"])
    return {int(y): pd.Timestamp(w) for y, w in weeks.items()}


NOMINATION_DATES = Path("data") / "tony-nomination-dates.json"
SHUTDOWN_CEREMONIES = {2020, 2021}


def week_ending(date):
    """Sunday that ends the Broadway reporting week containing `date`."""
    date = pd.Timestamp(date)
    return date + pd.Timedelta(days=(6 - date.weekday()) % 7)


def nomination_weeks(ceremonies, verified):
    """Year -> (week containing the nomination announcement, 'verified'|'approximate').

    Verified years use sourced announcement dates. Other years use the median
    verified gap (in weeks) before the ceremony week. Shutdown-era ceremonies,
    whose nominations came months earlier, are skipped.
    """
    known = {int(y): week_ending(v["date"]) for y, v in verified.items()
             if int(y) in ceremonies}
    gaps = [(ceremonies[y] - w).days // 7 for y, w in known.items()]
    gap = int(np.median(gaps)) if gaps else 5
    weeks = {}
    for year, ceremony in ceremonies.items():
        if year in SHUTDOWN_CEREMONIES:
            continue
        if year in known:
            weeks[year] = (known[year], "verified")
        else:
            weeks[year] = (ceremony - pd.Timedelta(weeks=gap), "approximate")
    return weeks, gap


def production_nominees(tony_rows):
    """(year, title, won) for production categories; header row is skipped."""
    nominees = {}
    for row in tony_rows[1:]:
        year, category, _, show, won, nominated = row[:6]
        if category in PRODUCTION_CATEGORIES and nominated and not show:
            raise ValueError(f"Missing production nominee title: {year}, {category}. "
                             "Repair the source data before running the study.")
        if category in PRODUCTION_CATEGORIES and nominated and show:
            ident = (int(year), show, category)
            nominees[ident] = max(nominees.get(ident, 0), int(won))
    return [(y, s, c, w) for (y, s, c), w in sorted(nominees.items())]


def tony_counts(tony_rows):
    """Per (year, title key): total wins and nominations across all categories."""
    counts = {}
    for row in tony_rows[1:]:
        year, _, _, show, won, nominated = row[:6]
        if not show:
            continue
        ident = (int(year), key(show))
        wins, noms = counts.get(ident, (0, 0))
        counts[ident] = (wins + int(won), noms + int(nominated))
    return counts


def match_title(title, candidates):
    """Match a Tony title to one running Broadway show key, or None if ambiguous."""
    target = key(title)
    if len(target) < 3:
        return None
    if target in candidates:
        return target
    stripped = key(re.sub(r"^[^']+'s\s+", "", title))
    hits = {c for c in candidates
            if min(len(c), len(target)) >= 4 and (target in c or c in target
                                                   or (len(stripped) >= 4 and stripped in c))}
    return hits.pop() if len(hits) == 1 else None


def week_of_year(weeks):
    return weeks.dt.isocalendar().week.astype(int).clip(upper=52)


def safe_float(value, digits=6):
    value = float(value)
    return None if not np.isfinite(value) else round(value, digits)
