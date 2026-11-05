"""Rebuild production-award records from saved official Tony archive pages."""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import re


CATEGORIES = {
    "Musical": "Musical", "Play": "Play", "Revival": "Revival",
    "Revival (Musical)": "Revival of a Musical",
    "Revival (Play)": "Revival of a Play",
    "Revival of a Musical": "Revival of a Musical",
    "Revival of a Play": "Revival of a Play",
}


def text(value):
    return html.unescape(re.sub(r"<[^>]*>", "", value)).strip()


def parse_archive(content, revival_only=False):
    records = []
    sections = re.split(r'<h2[^>]*class="category_title"[^>]*>(.*?)</h2>', content, flags=re.S)
    for heading, body in zip(sections[1::2], sections[2::2]):
        year, category = text(heading).split(" / ", 1)
        category = CATEGORIES.get(category.removeprefix("Best "))
        if category is None or (revival_only and category != "Revival"):
            continue
        items = re.split(r'<div class="item award-item[^"]*"[^>]*>', body)[1:]
        for item in items:
            title_match = re.search(r"<h3[^>]*>(.*?)</h3>", item, re.S)
            if not title_match:
                raise ValueError(f"Missing award title: {year}, {category}")
            heading_html = title_match.group(1)
            italic = re.search(r"<i>(.*?)</i>", heading_html, re.S)
            title = text(italic.group(1) if italic else heading_html)
            if not title or "\ufffd" in title:
                raise ValueError(f"Invalid title: {year}, {category}, {title!r}")
            winner = 'alt="Winner Globe"' in item
            if not winner and 'alt="Nominated Globe"' not in item:
                raise ValueError(f"Missing outcome: {year}, {title}")
            records.append([year, category, "", title, int(winner), 1, 0, ""])
    return records


def repair(root, evidence):
    path = root / "tony-dashboard-data.json"
    original_bytes = path.read_bytes()
    data = json.loads(original_bytes)
    original = data["rows"]
    sources, recovered = [], []
    names = ["musical", "play", "revival-musical", "revival-play"]
    names += [f"year-{year}" for year in [1977, 1978, *range(1980, 1994)]]
    for name in names:
        raw = (evidence / f"{name}.html").read_bytes()
        year = name.removeprefix("year-") if name.startswith("year-") else "any"
        category = "any" if name.startswith("year-") else name
        url = f"https://www.tonyawards.com/nominees/year/{year}/category/{category}/show/any/?partial"
        rows = parse_archive(raw.decode("utf-8-sig"), name.startswith("year-"))
        if not rows:
            raise ValueError(f"No production records in {name}")
        sources.append({"url": url, "sha256": hashlib.sha256(raw).hexdigest(),
                        "records": len(rows)})
        recovered.extend(rows)
    unique, duplicates = {}, []
    for row in recovered:
        identity = (row[0], row[1], row[3])
        if identity in unique:
            duplicates.append({"year": row[0], "category": row[1], "title": row[3],
                               "winnerFlags": [unique[identity][4], row[4]]})
            unique[identity][4] = max(unique[identity][4], row[4])
        else:
            unique[identity] = row
    recovered = list(unique.values())
    old_groups = {(r[0], "Revival" if int(r[0]) < 1994 and r[1].startswith("Revival") else r[1])
                  for r in original[1:] if r[1] in CATEGORIES.values()}
    new_groups = {(r[0], r[1]) for r in recovered}
    if old_groups - new_groups:
        raise ValueError(f"Missing historical groups: {old_groups - new_groups}")
    winners = defaultdict(set)
    retained = [r for r in original[1:] if r[1] not in CATEGORIES.values()]
    for row in retained + recovered:
        if row[4] and row[3]:
            winners[row[3]].add(row[0])
    for row in recovered:
        n = len(winners[row[3]])
        row[6:] = [n, "More than 1 winning year" if n > 1 else "1 winning year" if n else ""]
    grouped = defaultdict(list)
    for row in recovered:
        grouped[(row[0], row[1])].append(row)
    audit = [{"year": int(y), "category": c, "nominees": len(rows),
              "winners": sum(r[4] for r in rows),
              "nonWinners": sum(not r[4] for r in rows)}
             for (y, c), rows in sorted(grouped.items())]
    if any(not a["winners"] for a in audit):
        raise ValueError("Award group has no winner")
    data["rows"] = [original[0]] + sorted(retained + recovered, key=lambda r: (r[0], r[1], -r[4], r[3], r[2]))
    report = {
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Official Tony Awards winners and nominees archive",
        "originalSha256": hashlib.sha256(original_bytes).hexdigest(),
        "method": "Replace production-category rows with complete official records; preserve other categories. Read italicized title separately from producer credits; honor explicit winner icons, including historical ties.",
        "originalProductionRows": sum(r[1] in CATEGORIES.values() for r in original[1:]),
        "originalMissingTitles": sum(r[1] in CATEGORIES.values() and not r[3] for r in original[1:]),
        "correctedProductionRows": len(recovered),
        "remainingMissingProductionTitles": sum(not r[3] for r in recovered),
        "duplicateSourceEntriesCollapsed": duplicates,
        "sources": sources, "categoryYearCounts": audit,
        "productionRecords": recovered,
    }
    backup = root / "data" / "tony-production-before-repair.json"
    if not backup.exists():
        backup.write_text(json.dumps([r for r in original[1:] if r[1] in CATEGORIES.values()],
                                    ensure_ascii=True, indent=1) + "\n", encoding="utf-8")
    (root / "data" / "tony-production-provenance.json").write_text(
        json.dumps(report, ensure_ascii=True, indent=1) + "\n", encoding="utf-8")
    path.write_text(json.dumps(data, ensure_ascii=True, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items()
                      if k not in ("sources", "categoryYearCounts", "productionRecords")}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    repair(args.root, args.evidence)
