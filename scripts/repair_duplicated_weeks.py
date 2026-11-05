"""One-off repair: halve weekly rows that were stored as two identical records.

Every production's row for the 10 weeks ending 2025-01-05 through 2025-03-09 was
saved with records=2 and gross, seats sold and seats available exactly doubled, which
looks like the same Playbill week being added twice when the dataset was first built.
This rewrites those rows (and the overview/theatre aggregates built from them) as a
single record using the shared merge logic, which re-checks that all totals agree.

Run: python scripts/repair_duplicated_weeks.py [--dry-run]
"""
import argparse
import json
from pathlib import Path

from refresh_broadway import OUTPUTS, ROOT, key, load, merge_outputs


def doubled_rows(history):
    """Rows saved as two records whose counts are all even (an exact duplicate)."""
    return [r for r in history["rows"]
            if r[7] == 2 and r[4] % 2 == 0 and r[5] % 2 == 0]


def theatre_for(theatres, year, show, gross):
    """Theatre the doubled week was booked under.

    A show can appear under two names for the same house in one year (for example
    "Hayes Theater" and "Helen Hayes Theater"); the halving only reduces one row, so
    use the row with the most gross that year, which must cover the doubled week.
    """
    matches = [r for r in theatres["rows"] if r[0] == year and key(r[1]) == key(show)]
    if not matches:
        raise ValueError(f"No theatre row for {show} in {year}")
    row = max(matches, key=lambda r: r[3])
    if row[3] < gross:
        raise ValueError(f"Theatre row for {show} in {year} is smaller than one week")
    return row[2]


def repair(root=ROOT, dry_run=False):
    history, theatres, overview = [load(root, name) for name in OUTPUTS]
    rows = doubled_rows(history)
    old, new = [], []
    for week, year, show, gross, sold, available, ticket, _ in rows:
        theatre = theatre_for(theatres, year, show, gross)
        old.append([week, show, theatre, gross, sold, available, ticket])
        half_sold = sold // 2
        new.append([week, show, theatre, round(gross / 2, 2), half_sold, available // 2,
                    round(gross / 2 / half_sold) if half_sold else 0])
    if rows:
        outputs = merge_outputs(history, theatres, overview, old, new)
    if rows and not dry_run:
        for name, data in zip(OUTPUTS, outputs):
            (Path(root) / name).write_text(
                json.dumps(data, ensure_ascii=True, separators=(",", ":")) + "\n",
                encoding="utf-8")
    return sorted({r[0] for r in rows}), len(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    weeks, count = repair(args.root, args.dry_run)
    print(f"{'Would repair' if args.dry_run else 'Repaired'} {count} rows across "
          f"{len(weeks)} weeks: {weeks[0] if weeks else '-'} to {weeks[-1] if weeks else '-'}")


if __name__ == "__main__":
    main()
