"""Refresh the Playbill ticket-policy directory every 14 days, without guessing policies."""

import argparse
import copy
import datetime as dt
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unicodedata
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DATA = "ticket-access-data.json"
SOURCE = "https://playbill.com/article/broadway-rush-lottery-and-standing-room-only-policies-com-116003"
INTERVAL_DAYS = 14
EXCLUDED = {"cancellation line", "ponyboy seat", "student tickets", "military tickets"}
FIELDS = re.compile(
    r"^(Price|How|Where|Time|ID|Tickets Per Person|Payment Method|Seat Locations|"
    r"Seating Locations|Number of Tickets Available|Number of Lottery Tickets Available|"
    r"Special Policies)\s*:\s*(.*)$", re.I)


def clean(value):
    return re.sub(r"\s+", " ", value).strip()


def key(value):
    return "".join(c for c in unicodedata.normalize("NFKD", value).casefold() if c.isalnum())


def https(value):
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError(f"Unsafe or missing policy URL: {value!r}")
    return value


class GuideParser(HTMLParser):
    """Keep article lines and visible links; ignore navigation and empty editor links."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.found = False
        self.parts = []
        self.links = []
        self.anchor = None
        self.lines = []
        self.ignored = None

    def flush(self):
        text = clean("".join(self.parts))
        if text:
            self.lines.append((text, self.links))
        self.parts, self.links = [], []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if not self.depth:
            if tag == "div" and "prose" in attrs.get("class", "").split():
                self.found, self.depth = True, 1
            return
        if tag in {"script", "style"}:
            self.ignored = tag
        if self.ignored:
            return
        if tag == "div":
            self.depth += 1
        if tag in {"br", "p", "hr"}:
            self.flush()
        if tag == "a":
            self.anchor = [attrs.get("href", ""), []]

    def handle_endtag(self, tag):
        if not self.depth:
            return
        if self.ignored:
            if tag == self.ignored:
                self.ignored = None
            return
        if tag == "a" and self.anchor:
            if clean("".join(self.anchor[1])):
                self.links.append(self.anchor[0])
            self.anchor = None
        if tag in {"p", "div"}:
            self.flush()
        if tag == "div":
            self.depth -= 1

    def handle_data(self, data):
        if self.depth and not self.ignored:
            self.parts.append(data)
            if self.anchor:
                self.anchor[1].append(data)


def parse_guide(page):
    parser = GuideParser()
    parser.feed(page)
    parser.flush()
    if not parser.found or parser.depth:
        raise ValueError("Missing or truncated policy article body")
    offers = []
    production, section, fields, links = None, None, {}, {}

    def finish():
        if not section or section.casefold() in EXCLUDED:
            return
        category = ("Rush" if "rush" in section.casefold() or key(section) == "30under30"
                    else "Lottery" if "lottery" in section.casefold() or section == "The Friday Forty"
                    else "SRO" if section == "Standing Room" else None)
        if not category:
            raise ValueError(f"Unrecognized offer type: {section}")
        required = ("price", "how", "time", "tickets per person", "id")
        if not production or any(not fields.get(field) for field in required):
            raise ValueError(f"Incomplete policy: {production} / {section}")
        price = fields["price"]
        if not re.fullmatch(r"\$\d+(?:\.\d{1,2})?|\d+%\s+off\s+full\s+price\.?", price, re.I):
            raise ValueError(f"Unrecognized ticket price: {price}")
        candidates = links.get("where", []) + links.get("how", [])
        link = https(candidates[0]) if candidates else production["url"]
        offers.append({
            "show": production["show"], "theatre": production["theatre"],
            "category": category, "type": section, "price": price,
            "how": fields["how"], "where": fields.get("where", ""),
            "time": fields["time"], "id": fields["id"],
            "limit": fields["tickets per person"], "link": link,
            "source": SOURCE, "productionUrl": production["url"],
            "payment": fields.get("payment method", ""),
            "seating": fields.get("seat locations", fields.get("seating locations", "")),
            "availability": fields.get("number of tickets available",
                                       fields.get("number of lottery tickets available", "")),
            "note": fields.get("special policies", ""),
        })

    for text, anchors in parser.lines:
        production_urls = [url for url in anchors if urlparse(url).hostname in
                           {"playbill.com", "www.playbill.com"} and
                           urlparse(url).path.startswith("/production/")]
        if production_urls:
            finish()
            match = re.fullmatch(r"(.+?)\s*\((.+)\)", text)
            if len(production_urls) != 1 or not match:
                raise ValueError(f"Unrecognized production header: {text}")
            theatre = re.split(r"\s*[-\u2013\u2014]\s*(?=\d)", match[2], maxsplit=1)[0].strip()
            if not re.search(r"Theat(?:re|er)|Studio", theatre, re.I):
                raise ValueError(f"Missing theatre: {text}")
            production = {"show": match[1].strip(), "theatre": theatre,
                          "url": https(production_urls[0])}
            section, fields, links = None, {}, {}
            continue
        heading = text.rstrip(":").strip()
        if (re.fullmatch(r"(?:Digital|General|Student|In.person) Rush|Digital Lottery|"
                         r"Standing Room|The Friday Forty|\$30 Under 30", heading, re.I)
                or heading.casefold() in EXCLUDED):
            finish()
            section = next((name for name in ["Digital Rush", "General Rush", "Student Rush",
                                             "Digital Lottery", "Standing Room", "The Friday Forty",
                                             "$30 Under 30"] if name.casefold() == heading.casefold()), heading)
            fields, links = {}, {}
            continue
        match = FIELDS.fullmatch(text)
        if match and production:
            if not section:
                raise ValueError(f"Policy field without an offer type: {text}")
            field = match[1].casefold()
            if field in fields:
                raise ValueError(f"Duplicate policy field: {production['show']} / {section} / {field}")
            fields[field], links[field] = match[2].strip(), anchors
        elif section and section.casefold() not in EXCLUDED and text:
            raise ValueError(f"Unrecognized policy line: {text}")
    finish()
    identities = [(key(row["show"]), row["category"], key(row["type"])) for row in offers]
    if (len(offers) < 20 or len({key(row["show"]) for row in offers}) < 10
            or {row["category"] for row in offers} != {"Rush", "Lottery", "SRO"}
            or len(identities) != len(set(identities))):
        raise ValueError("Incomplete policy directory or duplicate offers")
    return offers


def fetch_page():
    result = subprocess.run(
        ["curl", "--fail", "--silent", "--show-error", "--location", "--retry", "3",
         "--retry-delay", "2", "--max-time", "60", "--user-agent", "Mozilla/5.0",
         "--proto", "=https", "--proto-redir", "=https",
         "--header", "Cache-Control: no-cache", SOURCE], check=True, capture_output=True)
    return result.stdout.decode("utf-8")


def check_link(url):
    result = subprocess.run(
        ["curl", "--silent", "--show-error", "--location", "--retry", "2",
         "--max-time", "30", "--user-agent", "Mozilla/5.0", "--output", os.devnull,
         "--proto", "=https", "--proto-redir", "=https",
         "--write-out", "%{http_code}\\n%{url_effective}", https(url)],
        check=True, capture_output=True, text=True)
    status, effective = result.stdout.strip().split("\n", 1)
    return int(status), https(effective)


def due(data, today):
    checked = dt.date.fromisoformat(data["checkedOn"])
    if checked > today:
        raise ValueError("Ticket policy check date is in the future")
    return (today - checked).days >= INTERVAL_DAYS


def refresh(root=ROOT, fetch=fetch_page, inspect_link=check_link, today=None, force=False,
            accept_large_removal=False):
    today = today or dt.datetime.now(dt.timezone.utc).date()
    path = root / DATA
    prior = json.loads(path.read_text(encoding="utf-8"))
    is_due = due(prior, today)
    if not force and not is_due:
        print(f"Ticket check not due; next check {dt.date.fromisoformat(prior['checkedOn']) + dt.timedelta(days=INTERVAL_DAYS)}")
        return False
    offers = parse_guide(fetch())
    old_keys = {(key(row["show"]), row["category"], key(row["type"])) for row in prior["offers"]}
    new_keys = {(key(row["show"]), row["category"], key(row["type"])) for row in offers}
    if len(old_keys - new_keys) > max(2, len(old_keys) * .2) and not accept_large_removal:
        raise ValueError("More than 20% of offers disappeared; review the source before accepting removals")
    names = {key(row["show"]): row["show"] for row in prior["offers"]}
    theatres = {key(row["theatre"]): row["theatre"] for row in prior["offers"]}
    previous = {(key(row["show"]), row["category"], key(row["type"])): row for row in prior["offers"]}
    results = {}
    issues = 0
    for row in offers:
        row["show"] = names.get(key(row["show"]), row["show"].title())
        row["theatre"] = theatres.get(key(row["theatre"]), row["theatre"])
        old = previous.get((key(row["show"]), row["category"], key(row["type"])), {})
        # Retain curated official box-office destinations, not previous policy text or prices.
        if row["link"] == row["productionUrl"] and old.get("link"):
            if urlparse(old["link"]).hostname not in {"playbill.com", "www.playbill.com"}:
                row["link"] = https(old["link"])
        url = row["link"]
        if url not in results:
            results[url] = inspect_link(url)
        status, effective = results[url]
        policy_note = row["note"]
        if 200 <= status < 300:
            row["link"] = https(effective)
        elif status in {403, 429}:
            row["note"] = clean(row["note"] + " Provider blocks automated access; confirm live availability on the linked page.")
            issues += 1
        elif status in {404, 410}:
            row["link"] = SOURCE
            row["note"] = clean(row["note"] + f" The guide's linked page returned HTTP {status}; confirm this offer through the policy guide before making plans.")
            curated = old.get("link")
            if (curated and curated != url and urlparse(curated).hostname == urlparse(url).hostname):
                https(curated)
                if curated not in results:
                    results[curated] = inspect_link(curated)
                curated_status, curated_effective = results[curated]
                if 200 <= curated_status < 300:
                    row["link"] = https(curated_effective)
                    row["note"] = clean(policy_note + f" The guide's entry link returned HTTP {status}; "
                                        "using a previously reviewed provider link that responded successfully. Confirm live availability.")
            issues += 1
        else:
            raise ValueError(f"Provider check failed: HTTP {status} for {url}")
    offers.sort(key=lambda row: (key(row["show"]), row["category"], row["type"]))
    data = copy.deepcopy(prior)
    data.update({
        "checkedOn": today.isoformat(), "source": SOURCE, "offers": offers,
        "verification": f"Automatically checked against the Playbill guide on {today.isoformat()}. "
                        f"{len(results)} distinct linked pages checked; {issues} offers have blocked or unavailable links. "
                        "Provider checks confirm link responses, not ticket inventory or agreement with every policy. "
                        "Prices and policies follow the guide; confirm with the provider before booking.",
        "automation": {"intervalDays": INTERVAL_DAYS,
                       "nextCheckOn": (today + dt.timedelta(days=INTERVAL_DAYS)).isoformat(),
                       "linkIssues": issues},
    })
    if data == prior:
        print(f"No changes; ticket guide checked {today}")
        return False
    with tempfile.TemporaryDirectory(dir=root) as staging:
        staged = Path(staging) / DATA
        staged.write_text(json.dumps(data, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
        staged.replace(path)
    print(f"Checked {len(offers)} offers across {len({key(row['show']) for row in offers})} productions; "
          f"{issues} offers need provider confirmation. Next check {data['automation']['nextCheckOn']}")
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--force", action="store_true", help="Check now, even if fewer than 14 days have elapsed")
    parser.add_argument("--accept-large-removal", action="store_true",
                        help="Accept a source-confirmed removal of more than 20% of offers")
    args = parser.parse_args()
    try:
        refresh(args.root, force=args.force, accept_large_removal=args.accept_large_removal)
    except (ValueError, KeyError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Ticket policy refresh failed; existing data preserved: {error}\n")
