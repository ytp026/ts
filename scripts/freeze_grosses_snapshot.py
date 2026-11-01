"""Freeze a one-time numeric snapshot of weekly Broadway grosses for modeling.

The live dashboard keeps refreshing history-dashboard-data.json every week. The
causal study, forecast models and NLP join instead read this frozen CSV so that
training data never grows from new scrapes. Only factual figures are stored
(show title, week, gross, seats sold/available, capacity, average ticket); no
article text. Source: The Broadway League, via https://playbill.com/grosses.
"""

import argparse
import csv
import datetime as dt
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_DIR = Path("data") / "snapshots"
COLUMNS = ["week", "show", "gross", "seats_sold", "seats_available", "capacity",
           "avg_ticket"]
SOURCE = ("Weekly grosses reported by The Broadway League, collected from Playbill's "
          "public grosses page (https://playbill.com/grosses). Factual figures only.")


def snapshot_rows(history_rows):
    """Aggregate dashboard rows to one numeric record per (week, show)."""
    totals = {}
    for week, _year, show, gross, sold, available, *_ in history_rows:
        entry = totals.setdefault((week, show), [0.0, 0, 0])
        entry[0] += float(gross or 0)
        entry[1] += int(sold or 0)
        entry[2] += int(available or 0)
    rows = []
    for (week, show), (gross, sold, available) in sorted(totals.items()):
        capacity = round(sold / available, 4) if available else ""
        avg_ticket = round(gross / sold, 2) if sold else ""
        rows.append([week, show, round(gross, 2), sold, available, capacity, avg_ticket])
    return rows


def freeze(root=ROOT, stamp=None, force=False):
    root = Path(root)
    folder = root / SNAPSHOT_DIR
    pointer = folder / "CURRENT"
    if pointer.exists() and not force:
        raise SystemExit(f"Snapshot already frozen: {pointer.read_text().strip()} "
                         "(use --force to replace it deliberately)")
    data = json.loads((root / "history-dashboard-data.json").read_text(encoding="utf-8"))
    rows = snapshot_rows(data["rows"])
    stamp = stamp or dt.date.today().strftime("%Y%m%d")
    name = f"grosses_snapshot_{stamp}.csv"
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / name).open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(COLUMNS)
        writer.writerows(rows)
    digest = hashlib.sha256((folder / name).read_bytes()).hexdigest()
    manifest = {
        "file": name, "frozenOn": f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:]}",
        "weeks": [rows[0][0], max(r[0] for r in rows)], "rows": len(rows),
        "shows": len({r[1] for r in rows}), "columns": COLUMNS, "sha256": digest,
        "source": SOURCE,
        "use": ("Non-commercial portfolio and educational modeling only. Training reads "
                "this file; new weekly data is used only for scoring and drift monitoring."),
    }
    (folder / name.replace(".csv", ".manifest.json")).write_text(
        json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    pointer.write_text(name + "\n", encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--stamp", help="YYYYMMDD label (default: today)")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    manifest = freeze(args.root, args.stamp, args.force)
    print(f"Froze {manifest['rows']} show-weeks ({manifest['weeks'][0]} to "
          f"{manifest['weeks'][1]}) -> {SNAPSHOT_DIR / manifest['file']}")


if __name__ == "__main__":
    main()
