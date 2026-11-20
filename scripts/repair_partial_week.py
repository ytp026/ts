"""One-off repair: replace a week that was saved from a partial Playbill scrape.

The week ending 2025-07-27 was stored with only 17 of the ~28 productions that
played, which showed up as a sharp one-week dip in the market chart. This re-fetches
the week, swaps the stored rows for the complete set through the shared merge logic
(which re-checks that history, theatre and overview totals agree), and rewrites that
week's rows in the frozen training snapshot.

Run: python scripts/repair_partial_week.py [--week 2025-07-27] [--dry-run]
"""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path

from freeze_grosses_snapshot import snapshot_rows
from refresh_broadway import OUTPUTS, ROOT, fetch_page, key, load, merge_outputs, parse_page

SNAPSHOT = Path("data/snapshots/grosses_snapshot_20261102.csv")


def theatre_for(theatres, year, show):
    matches = [r for r in theatres["rows"] if r[0] == year and key(r[1]) == key(show)]
    if not matches:
        raise ValueError(f"No theatre row for {show} in {year}")
    return max(matches, key=lambda r: r[3])[2]


def canonical(overview, show, theatre):
    """Use the overview's spelling of an existing production so names stay unique."""
    same = [p for p in overview["productions"] if key(p["show"]) == key(show)]
    exact = [p for p in same if key(p["theatre"]) == key(theatre)]
    pick = exact or same
    if pick:
        return pick[0]["show"], pick[0]["theatre"]
    return show, theatre


def snapshot_lines(history_rows, week):
    out = io.StringIO()
    csv.writer(out, lineterminator="\n").writerows(
        snapshot_rows([r for r in history_rows if r[0] == week]))
    return out.getvalue().splitlines()


def repair_snapshot(path, week, history_rows):
    raw = path.read_bytes().decode("utf-8")
    newline = "\r\n" if "\r\n" in raw else "\n"
    lines = raw.split(newline)
    trailing = lines[-1] == ""
    body = [l for l in lines if l]
    header, rows = body[0], body[1:]
    kept = [l for l in rows if not l.startswith(week + ",")]
    first = next(i for i, l in enumerate(rows) if l.startswith(week + ","))
    insert_at = sum(1 for l in rows[:first] if not l.startswith(week + ","))
    fresh = snapshot_lines(history_rows, week)
    kept[insert_at:insert_at] = fresh
    path.write_bytes((newline.join([header] + kept) + (newline if trailing else "")).encode("utf-8"))
    manifest = path.with_name(path.name.replace(".csv", ".manifest.json"))
    if manifest.exists():
        info = json.loads(manifest.read_text(encoding="utf-8"))
        info["rows"] = len(kept)
        info["shows"] = len({next(csv.reader([l]))[1] for l in kept})
        info["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        manifest.write_text(json.dumps(info, indent=1) + "\n", encoding="utf-8")
    return len(fresh)


def repair(week, root=ROOT, dry_run=False, fetch=fetch_page):
    history, theatres, overview = [load(root, name) for name in OUTPUTS]
    old = [[w, show, theatre_for(theatres, year, show), gross, sold, available, ticket]
           for w, year, show, gross, sold, available, ticket, _ in history["rows"] if w == week]
    parsed_week, fetched = parse_page(fetch(week), week)
    if parsed_week != week:
        raise ValueError(f"Fetched {parsed_week}, expected {week}")
    if len(fetched) <= len(old):
        raise ValueError(f"Re-fetch has {len(fetched)} shows, not more than stored {len(old)}")
    new = []
    for w, show, theatre, gross, sold, available, ticket in fetched:
        show, theatre = canonical(overview, show, theatre)
        new.append([w, show, theatre, gross, sold, available, ticket])
    outputs = merge_outputs(history, theatres, overview, old, new)
    if not dry_run:
        for name, data in zip(OUTPUTS, outputs):
            (Path(root) / name).write_text(
                json.dumps(data, ensure_ascii=True, separators=(",", ":")) + "\n",
                encoding="utf-8")
        snapshot = Path(root) / SNAPSHOT
        if snapshot.exists():
            repair_snapshot(snapshot, week, outputs[0]["rows"])
    return len(old), len(new), sum(r[3] for r in new)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--week", default="2025-07-27")
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    before, after, gross = repair(args.week, args.root, args.dry_run)
    print(f"{'Would replace' if args.dry_run else 'Replaced'} {args.week}: "
          f"{before} -> {after} shows, gross ${gross:,.2f}")


if __name__ == "__main__":
    main()
