"""Collect Wikipedia 'Critical reception' sections for Broadway productions.

Text is licensed CC BY-SA 4.0 by Wikipedia contributors. The raw text is kept
only in a local, git-ignored cache (data/cache/) for scoring; the repository and
site store only derived sentiment scores plus article URL and revision id for
attribution. Sentences about box office, closings, awards or performance counts
are dropped before scoring because they can leak the outcomes the models predict.
"""

import argparse
import csv
import json
from pathlib import Path
import re
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = ("TheaterSpotlightPortfolio/1.0 (https://ytp026.github.io/ts/; "
              "non-commercial research) python-urllib")
OUTPUT = "data/cache/wikipedia-reception.json"
SNAPSHOT_DIR = Path("data") / "snapshots"
LICENSE = "CC BY-SA 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
SECTION = re.compile(
    r"^(critical\s+(reception|response|reaction|reviews?)|reception|critics'?\s+"
    r"(reception|response)|reviews?|response)$", re.I)
LEAK = re.compile(
    r"gross|box[- ]office|closed|closing|clos(e|es) on|performances|recoup|tony|"
    r"award|nominat|ticket|sales|\$|million|record|transfer|extended|extension|"
    r"previews? (began|started)|ran for|final performance", re.I)
MIN_RUN_START = "1996-01-01"
MAX_CHARS = 8000


def key(value):
    return "".join(c for c in unicodedata.normalize("NFKD", str(value)).casefold()
                   if c.isalnum())


def get(params, opener=urllib.request.urlopen, retries=3):
    query = urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    request = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with opener(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except OSError:
            if attempt == retries - 1:
                raise
            time.sleep(2 * (attempt + 1))


def candidates(title):
    base = re.sub(r"\s+", " ", title).strip()
    return [f"{base} (musical)", f"{base} (play)", base]


def resolve(titles, fetch=get):
    """Map each candidate title to an existing, non-disambiguation article title."""
    found = {}
    for start in range(0, len(titles), 50):
        batch = titles[start:start + 50]
        data = fetch({"action": "query", "titles": "|".join(batch), "redirects": 1,
                      "prop": "pageprops", "ppprop": "disambiguation"})
        query = data.get("query", {})
        mapping = {t: t for t in batch}
        for item in query.get("normalized", []) + query.get("redirects", []):
            for original, target in list(mapping.items()):
                if target == item["from"]:
                    mapping[original] = item["to"]
        pages = {p["title"]: p for p in query.get("pages", [])}
        for original, target in mapping.items():
            page = pages.get(target)
            if page and not page.get("missing") and "disambiguation" not in page.get(
                    "pageprops", {}):
                found[original] = target
    return found


def split_sections(text):
    """Plain-text extract with '== Heading ==' markers -> [(level, heading, body)]."""
    parts = re.split(r"^(={2,6})\s*(.+?)\s*\1\s*$", text, flags=re.M)
    sections = [(1, "", parts[0])]
    for index in range(1, len(parts), 3):
        sections.append((len(parts[index]), parts[index + 1], parts[index + 2]))
    return sections


def reception_text(text):
    """Return (heading, text) of the reception section including its subsections."""
    sections = split_sections(text)
    for i, (level, heading, body) in enumerate(sections):
        if SECTION.match(heading.strip()):
            chunks = [body]
            for sub_level, _, sub_body in sections[i + 1:]:
                if sub_level <= level:
                    break
                chunks.append(sub_body)
            cleaned = re.sub(r"\s+", " ", " ".join(chunks)).strip()
            if cleaned:
                return heading.strip(), cleaned[:MAX_CHARS]
    return None, None


def is_broadway_article(title, text):
    head = text[:3000].lower()
    themed = "(musical)" in title or "(play)" in title or any(
        word in head for word in ("musical", " play ", "play by", "play written"))
    return "broadway" in text.lower() and themed


def sentences(text):
    return [s.strip() for s in re.split(
        r"(?:(?<=[.!?])|(?<=[.!?][\"”’)]))\s+(?=[A-Z“\"])", text) if len(s.strip()) > 20]


def review_sentences(text):
    return [s for s in sentences(text) if not LEAK.search(s)]


def article(title, fetch=get):
    data = fetch({"action": "query", "titles": title, "prop": "extracts|revisions",
                  "explaintext": 1, "exsectionformat": "wiki", "rvprop": "ids|timestamp"})
    page = data["query"]["pages"][0]
    revision = (page.get("revisions") or [{}])[0]
    return page.get("extract", ""), revision.get("revid"), revision.get("timestamp")


def shows_to_collect(history):
    """history: iterable of (week, show) pairs; shows with any week since 1996."""
    starts = {}
    for week, show in history:
        if week >= MIN_RUN_START:
            starts.setdefault(show, week)
    return sorted(starts)


def snapshot_weeks(root):
    folder = Path(root) / SNAPSHOT_DIR
    name = (folder / "CURRENT").read_text(encoding="utf-8").strip()
    with (folder / name).open(encoding="utf-8", newline="") as handle:
        return [(row["week"], row["show"]) for row in csv.DictReader(handle)]


def collect(root, fetch=get, pause=0.2, existing=None, limit=None):
    shows = shows_to_collect(snapshot_weeks(root))[:limit]
    records = dict((existing or {}).get("pages", {}))
    pending = [s for s in shows if key(s) not in records]
    titles = [c for s in pending for c in candidates(s)]
    resolved = resolve(titles, fetch)
    checked = 0
    for show in pending:
        for candidate in candidates(show):
            target = resolved.get(candidate)
            if not target:
                continue
            text, revid, stamp = article(target, fetch)
            checked += 1
            time.sleep(pause)
            if not is_broadway_article(target, text):
                continue
            heading, section = reception_text(text)
            if not section:
                continue
            records[key(show)] = {
                "show": show, "article": target,
                "url": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(
                    target.replace(" ", "_")),
                "revisionId": revid, "revisionTimestamp": stamp,
                "section": heading, "text": section}
            break
    return {
        "source": "Wikipedia, The Free Encyclopedia",
        "license": LICENSE, "licenseUrl": LICENSE_URL,
        "attribution": ("Text excerpted from the linked English Wikipedia articles' "
                        "critical reception sections, by Wikipedia contributors, under "
                        "CC BY-SA 4.0. Whitespace was normalised and long sections truncated."),
        "showsConsidered": len(shows), "articlesChecked": checked,
        "pages": dict(sorted(records.items()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--refresh", action="store_true",
                        help="Re-collect every show instead of only uncollected ones")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    path = args.root / OUTPUT
    existing = None
    if path.exists() and not args.refresh:
        existing = json.loads(path.read_text(encoding="utf-8"))
    result = collect(args.root, existing=existing, limit=args.limit)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Collected reception sections for {len(result['pages'])} of "
          f"{result['showsConsidered']} shows")


if __name__ == "__main__":
    main()
