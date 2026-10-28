"""Refresh public Playbill weekly grosses without rebuilding undocumented PBIP history."""

import argparse
import copy
import datetime as dt
from decimal import Decimal
import html
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://playbill.com/grosses"
WEEKLY = "broadway-weekly-data.json"
OUTPUTS = ("history-dashboard-data.json", "theatres-dashboard-data.json",
           "broadway-overview-data.json")


def text(value):
    return html.unescape(re.sub(r"<[^>]*>", "", value)).strip()


def key(value):
    return "".join(c for c in unicodedata.normalize("NFKD", value).casefold()
                   if c.isalnum())


def number(value, integer=False):
    cleaned = value.strip().replace("$", "").replace(",", "")
    if not re.fullmatch(r"\d+(?:\.\d+)?", cleaned):
        raise ValueError(f"Invalid source number: {value!r}")
    result = Decimal(cleaned)
    if integer and result != result.to_integral_value():
        raise ValueError(f"Expected integer: {value!r}")
    if not integer and not math.isfinite(float(result)):
        raise ValueError(f"Nonfinite source number: {value!r}")
    return int(result) if integer else float(result)


def spans(cell):
    return {kind: text(value) for kind, value in re.findall(
        r'<span class="(data-value|subtext)"[^>]*>(.*?)</span>', cell, re.S)}


def parse_page(page, expected=None):
    options = re.findall(r'<option\b([^>]*)>(.*?)</option>', page, re.S)
    selected = [text(value) for attrs, value in options
                if re.search(r"\bselected\b", attrs)]
    if len(selected) != 1:
        raise ValueError("Source does not identify exactly one selected week")
    week = selected[0]
    date = dt.date.fromisoformat(week)
    if date.weekday() != 6 or (expected and week != expected):
        raise ValueError(f"Source returned unexpected week {week}; requested {expected}")
    table = re.search(r'<tbody>(.*?)</tbody>', page, re.S)
    if not table:
        raise ValueError("Missing weekly gross table")
    records = []
    for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', table[1], re.S):
        cells = dict(re.findall(r'<td\b[^>]*data-label="([^"]+)"[^>]*>(.*?)</td>',
                                row, re.S))
        show = spans(cells["Show"])
        seats = spans(cells["Seats Sold"])
        performances = spans(cells["Perfs"])
        gross = number(spans(cells["This Week Gross"])["data-value"])
        sold = number(seats["data-value"], True)
        available = number(seats["subtext"], True) * (
            number(performances["data-value"], True)
            + number(performances["subtext"], True))
        ticket = number(spans(cells["Avg Ticket"])["data-value"])
        if not show["data-value"] or not show["subtext"] or available <= 0:
            raise ValueError("Missing show/theatre or nonpositive available seats")
        records.append([week, show["data-value"], show["subtext"],
                        gross, sold, available, ticket])
    identities = [(key(r[1]), key(r[2])) for r in records]
    if len(records) < 10 or len(set(identities)) != len(records):
        raise ValueError("Incomplete weekly table or duplicate productions")
    # Reconcile the entire table against the publisher's independent headline total.
    total = re.search(r'week-total.*?<span class="accent">([^<]+)</span>', page, re.S)
    if not total or abs(sum(Decimal(str(r[3])) for r in records)
                        - Decimal(str(number(text(total[1]))))) > Decimal("0.01"):
        raise ValueError("Weekly gross rows do not reconcile to Playbill's total")
    return week, records


def fetch_page(week=None):
    url = SOURCE if week is None else f"{SOURCE}?week={week}"
    result = subprocess.run(
        ["curl", "--fail", "--silent", "--show-error", "--location",
         "--retry", "3", "--retry-delay", "2", "--max-time", "60",
         "--user-agent", "Mozilla/5.0", url],
        check=True, capture_output=True)
    return result.stdout.decode("utf-8")


def load(root, name):
    return json.loads((root / name).read_text(encoding="utf-8"))


def merge_outputs(history, theatres, overview, old_records, new_records):
    history, theatres, overview = copy.deepcopy((history, theatres, overview))
    productions = {(key(p["show"]), key(p["theatre"])): p
                   for p in overview["productions"]}
    if len(productions) != len(overview["productions"]):
        raise ValueError("Ambiguous normalized production names in overview")
    theatre_rows = {(r[0], key(r[1]), key(r[2])): r for r in theatres["rows"]}
    history_rows = {(r[0], key(r[2])): r for r in history["rows"]}
    if len(history_rows) != len(history["rows"]):
        raise ValueError("Duplicate normalized week/show keys in history")
    period_weeks = {
        period: {e["week"] for p in overview["productions"] for e in p["periods"][period]}
        for period in ("before", "after")
    }
    for sign, records in ((-1, old_records), (1, new_records)):
        for week, show, theatre, gross, sold, available, ticket in records:
            identity = (key(show), key(theatre))
            if identity not in productions:
                if sign < 0:
                    raise ValueError("Previous weekly production missing from overview")
                production = {"show": show, "theatre": theatre, "totalGross": 0,
                              "totalSeats": 0, "availableSeats": 0,
                              "periods": {"before": [], "after": []}}
                overview["productions"].append(production)
                productions[identity] = production
            production = productions[identity]
            for field, value in (("totalGross", gross), ("totalSeats", sold),
                                 ("availableSeats", available)):
                production[field] = round(production[field] + sign * value, 2)
            year_key = (week[:4], *identity)
            if year_key not in theatre_rows:
                row = [week[:4], production["show"], production["theatre"], 0, 0, 0]
                theatres["rows"].append(row)
                theatre_rows[year_key] = row
            for index, value in ((3, gross), (4, sold), (5, available)):
                theatre_rows[year_key][index] = round(
                    theatre_rows[year_key][index] + sign * value, 2)
            hkey = (week, key(production["show"]))
            if sign < 0:
                if hkey not in history_rows:
                    raise ValueError("Previous weekly record missing from history")
                del history_rows[hkey]
            else:
                if hkey in history_rows:
                    raise ValueError(f"Duplicate week/show: {hkey}")
                history_rows[hkey] = [week, week[:4], production["show"], gross,
                                     sold, available, ticket, 1]
            for period, weeks in period_weeks.items():
                if week in weeks:
                    production["periods"][period] = [
                        e for e in production["periods"][period] if e["week"] != week]
                    if sign > 0:
                        production["periods"][period].append({
                            "week": week, "gross": gross, "seats": sold,
                            "availableSeats": available})
                        production["periods"][period].sort(key=lambda e: e["week"])
    history["rows"] = list(history_rows.values())
    theatres["rows"].sort(key=lambda r: (r[0], r[1], r[2]))
    overview["productions"].sort(key=lambda p: (p["show"], p["theatre"]))
    totals = [sum(Decimal(str(r[3])) for r in history["rows"]),
              sum(Decimal(str(r[3])) for r in theatres["rows"]),
              sum(Decimal(str(p["totalGross"])) for p in overview["productions"])]
    if max(totals) - min(totals) > Decimal("0.02"):
        raise ValueError("History, theatre and overview gross totals disagree")
    return history, theatres, overview


def refresh(root=ROOT, fetch=fetch_page, today=None, recheck_all=False):
    today = today or dt.date.today()
    history, theatres, overview = [load(root, name) for name in OUTPUTS]
    prior = load(root, WEEKLY) if (root / WEEKLY).exists() else {
        "baselineWeek": max(r[0] for r in history["rows"]), "rows": []}
    baseline = dt.date.fromisoformat(prior["baselineWeek"])
    latest, latest_records = parse_page(fetch())
    latest_date = dt.date.fromisoformat(latest)
    if not 0 <= (today - latest_date).days <= 14:
        raise ValueError(f"Playbill's latest week {latest} is stale or in the future")
    previous_latest = max((r[0] for r in prior["rows"]), default=baseline.isoformat())
    if latest < previous_latest:
        raise ValueError("Source week regressed")
    records_by_week = {}
    for record in prior["rows"]:
        records_by_week.setdefault(record[0], []).append(record)
    first = baseline + dt.timedelta(days=7) if recheck_all else max(
        baseline + dt.timedelta(days=7),
        dt.date.fromisoformat(previous_latest) - dt.timedelta(days=7))
    date = first
    while date <= latest_date:
        week = date.isoformat()
        records_by_week[week] = (latest_records if week == latest else
                                 parse_page(fetch(week), week)[1])
        print(f"Validated {week}: {len(records_by_week[week])} productions")
        date += dt.timedelta(days=7)
    expected = { (baseline + dt.timedelta(days=7 * i)).isoformat()
                 for i in range(1, (latest_date - baseline).days // 7 + 1) }
    if set(records_by_week) != expected:
        raise ValueError("Weekly archive has gaps or unexpected dates")
    records = [r for week in sorted(records_by_week) for r in records_by_week[week]]
    if records == prior["rows"]:
        print(f"No changes; data through {latest}")
        return False
    outputs = merge_outputs(history, theatres, overview, prior["rows"], records)
    metadata = {"generatedAt": today.isoformat(), "latestWeek": latest,
                "source": SOURCE, "baselineWeek": prior["baselineWeek"]}
    payloads = {name: {**data, **metadata} for name, data in zip(OUTPUTS, outputs)}
    payloads[WEEKLY] = {**metadata, "rows": records}
    # Stage every validated payload before replacing any tracked file.
    with tempfile.TemporaryDirectory(dir=root) as staging:
        for name, data in payloads.items():
            path = Path(staging) / name
            path.write_text(json.dumps(data, ensure_ascii=True, separators=(",", ":"))
                            + "\n", encoding="utf-8")
        for name in payloads:
            (Path(staging) / name).replace(root / name)
    print(f"Updated all gross datasets through {latest}")
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--recheck-all", action="store_true",
                        help="Reacquire all post-baseline weeks for older corrections")
    args = parser.parse_args()
    try:
        refresh(args.root, recheck_all=args.recheck_all)
    except subprocess.CalledProcessError as error:
        parser.exit(1, f"Source acquisition failed: {error.stderr.decode('utf-8', errors='replace')}\n")
