import datetime as dt
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from scripts.refresh_ticket_policies import DATA, SOURCE, due, parse_guide, refresh


def guide(price="$40", drop_rush=0, extra_show=False):
    """Synthetic policies, not production data."""
    blocks = []
    for i in range(10 + int(extra_show)):
        blocks.append(
            f'<p><a href="https://playbill.com/production/example-{i}">'
            f'<strong>EXAMPLE {i}</strong></a> (Example Theatre {i} - 123 W. 45th St.)<br>')
        for kind in ["Digital Rush", "Digital Lottery", "Standing Room"]:
            if kind == "Digital Rush" and i < drop_rush:
                continue
            blocks.append(
                f'<strong><u>{kind}</u></strong><br><strong>Price:</strong> {price}<br>'
                '<strong>How</strong>: Apply on the performance day.<br>'
                '<strong>Where:</strong> '
                '<a href="https://wrong.example/"></a>'
                '<a href="https://tickets.example/entry">Entry form</a><br>'
                '<strong>Time:</strong> 9 AM<br><strong>Payment Method:</strong> Credit card<br>'
                '<strong>ID:</strong> Photo ID<br><strong>Tickets per Person:</strong> Limit 2<br>'
                '<strong>Special Policies:</strong> Limited availability.</p><p>')
        blocks.append('</p><hr>')
    return ('<a href="https://playbill.com/production/decoy">Outside article</a>'
            '<div class="prose"><p>Introduction.</p></div>'
            '<div class="prose"><div class="ad-slot-marker"></div>'
            '<script>Price: $999</script>' + "".join(blocks) + '</div>')


def baseline():
    return {"checkedOn": "2026-10-14", "source": SOURCE, "scope": "Synthetic policies",
            "verification": "Synthetic test data", "offers": parse_guide(guide())}


class TicketParserTests(unittest.TestCase):
    def test_fields_links_nested_markup_and_article_boundaries(self):
        offers = parse_guide(guide())
        self.assertEqual(len(offers), 30)
        first = offers[0]
        self.assertEqual(first["show"], "EXAMPLE 0")
        self.assertEqual(first["theatre"], "Example Theatre 0")
        self.assertEqual(first["link"], "https://tickets.example/entry")
        self.assertEqual(first["price"], "$40")
        self.assertEqual(first["payment"], "Credit card")
        self.assertEqual(first["note"], "Limited availability.")
        self.assertEqual(first["source"], SOURCE)

    def test_missing_fields_duplicates_unknown_types_and_truncation_fail(self):
        for content in [
            "Access denied",
            guide().replace('<strong>Price:</strong> $40', ""),
            guide().replace("Digital Rush", "Premium Lottery"),
            guide().replace("EXAMPLE 1", "EXAMPLE 0"),
            guide().replace("$40", "Contact seller"),
            guide().replace("https://tickets.example/entry", "javascript:alert(1)"),
            guide().replace("https://tickets.example/entry", "https://user:pass@tickets.example/"),
            guide().rsplit("</div>", 1)[0],
        ]:
            with self.subTest(content=content[:60]), self.assertRaises(ValueError):
                parse_guide(content)

    def test_excluded_advance_discounts_do_not_overwrite_lottery(self):
        content = guide()
        content = content.rsplit("</div>", 1)[0] + """
<p><strong>Student Tickets</strong><br><strong>Price:</strong> $59<br>
<strong>How:</strong> Advance student tickets.<br><strong>Time:</strong> Select dates.<br>
<strong>ID:</strong> Student ID<br><strong>Tickets Per Person:</strong> Limit 2</p></div>"""
        offers = parse_guide(content)
        self.assertEqual(len(offers), 30)
        self.assertTrue(all(row["price"] == "$40" for row in offers))

    def test_split_heading_optional_where_and_percentage_price(self):
        content = guide().replace("Digital Rush", "Digital Rus</u></strong><strong><u>h")
        content = content.replace(
            '<strong>Where:</strong> <a href="https://wrong.example/"></a>'
            '<a href="https://tickets.example/entry">Entry form</a><br>', "")
        offers = parse_guide(content)
        self.assertEqual(offers[0]["type"], "Digital Rush")
        self.assertEqual(offers[0]["link"], offers[0]["productionUrl"])
        self.assertEqual(parse_guide(guide(price="50% off full price."))[0]["price"], "50% off full price.")

    def test_future_last_check_is_not_treated_as_not_due(self):
        with self.assertRaisesRegex(ValueError, "future"):
            due({"checkedOn": "2026-10-29"}, dt.date(2026, 10, 28))


class TicketRefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / DATA
        self.prior = baseline()
        self.path.write_text(json.dumps(self.prior), encoding="utf-8")
        self.today = dt.date(2026, 10, 28)

    def run_refresh(self, source=None, checker=None, **options):
        return refresh(self.root, source or (lambda: guide()),
                       checker or (lambda url: (200, url)), self.today, **options)

    def test_fourteen_day_boundary_and_no_source_requests_before_due(self):
        self.assertFalse(due(self.prior, dt.date(2026, 10, 27)))
        self.assertTrue(due(self.prior, self.today))
        self.assertTrue(due(self.prior, dt.date(2026, 10, 29)))
        self.prior["checkedOn"] = "2026-10-15"
        self.path.write_text(json.dumps(self.prior))
        original = self.path.read_bytes()
        def unexpected():
            self.fail("A policy request was made before 14 days elapsed")
        self.assertFalse(self.run_refresh(unexpected))
        self.assertEqual(original, self.path.read_bytes())
        self.assertTrue(self.run_refresh(force=True))

    def test_changes_additions_next_check_link_deduplication_and_idempotency(self):
        calls = []
        def checker(url):
            calls.append(url)
            return 200, url
        self.assertTrue(self.run_refresh(lambda: guide(price="$45", extra_show=True), checker))
        data = json.loads(self.path.read_text())
        self.assertEqual(len(data["offers"]), 33)
        self.assertTrue(all(row["price"] == "$45" for row in data["offers"]))
        self.assertEqual(len(calls), 1)
        self.assertEqual(data["automation"]["nextCheckOn"], "2026-11-11")
        self.assertEqual(data["automation"]["intervalDays"], 14)
        original = self.path.read_bytes()
        self.assertFalse(self.run_refresh(lambda: guide(price="$45", extra_show=True), force=True))
        self.assertEqual(original, self.path.read_bytes())
        self.assertFalse(self.run_refresh())

    def test_blocked_broken_and_redirected_links_have_explicit_results(self):
        for status in [403, 429, 404, 410, 200]:
            with self.subTest(status=status):
                self.path.write_text(json.dumps(self.prior))
                self.assertTrue(self.run_refresh(checker=lambda url: (status, "https://tickets.example/new"), force=True))
                data = json.loads(self.path.read_text())
                first = data["offers"][0]
                if status in {404, 410}:
                    self.assertEqual(first["link"], SOURCE)
                    self.assertIn(f"HTTP {status}", first["note"])
                elif status in {403, 429}:
                    self.assertIn("blocks automated access", first["note"])
                else:
                    self.assertEqual(first["link"], "https://tickets.example/new")
                self.assertEqual(data["automation"]["linkIssues"], 0 if status == 200 else 30)

    def test_failures_preserve_all_bytes_and_review_date(self):
        def unavailable():
            raise subprocess.CalledProcessError(22, "curl", stderr=b"HTTP 503")
        for source, checker in [
            (unavailable, None),
            (lambda: "Access denied", None),
            (lambda: guide().replace("Photo ID", ""), None),
            (None, lambda url: (503, url)),
            (None, lambda url: (200, "http://insecure.example/")),
        ]:
            original = self.path.read_bytes()
            with self.subTest(source=source), self.assertRaises((ValueError, subprocess.CalledProcessError)):
                self.run_refresh(source, checker)
            self.assertEqual(original, self.path.read_bytes())
            self.assertEqual(list(self.root.iterdir()), [self.path])

    def test_large_removals_need_explicit_acceptance_and_small_removals_apply(self):
        original = self.path.read_bytes()
        with self.assertRaisesRegex(ValueError, "20%"):
            self.run_refresh(lambda: guide(drop_rush=7))
        self.assertEqual(original, self.path.read_bytes())
        self.assertTrue(self.run_refresh(lambda: guide(drop_rush=7), accept_large_removal=True))
        self.assertEqual(len(json.loads(self.path.read_text())["offers"]), 23)
        self.assertTrue(self.run_refresh(lambda: guide(drop_rush=8), force=True))
        self.assertEqual(len(json.loads(self.path.read_text())["offers"]), 22)

    def test_curated_names_and_box_office_links_survive_but_old_policy_does_not(self):
        first = self.prior["offers"][0]
        first.update({"link": "https://official.example/tickets", "how": "Old policy"})
        for row in self.prior["offers"]:
            if row["show"] == "EXAMPLE 0":
                row["show"] = "Example 0"
        self.path.write_text(json.dumps(self.prior))
        content = guide().replace(
            '<strong>Where:</strong> <a href="https://wrong.example/"></a>'
            '<a href="https://tickets.example/entry">Entry form</a><br>', "")
        self.run_refresh(lambda: content)
        first = next(row for row in json.loads(self.path.read_text())["offers"]
                     if row["show"] == "Example 0" and row["type"] == "Digital Rush")
        self.assertEqual(first["link"], "https://official.example/tickets")
        self.assertNotEqual(first["how"], "Old policy")

    def test_outdated_entry_url_uses_curated_same_provider_only_when_it_still_works(self):
        self.prior["offers"][0]["link"] = "https://tickets.example/canonical"
        self.path.write_text(json.dumps(self.prior))
        def checker(url):
            return (200 if url.endswith("/canonical") else 404), url
        self.run_refresh(checker=checker)
        first = next(row for row in json.loads(self.path.read_text())["offers"]
                     if row["show"] == "EXAMPLE 0" and row["type"] == "Digital Rush")
        self.assertEqual(first["link"], "https://tickets.example/canonical")
        self.assertIn("previously reviewed provider link", first["note"])
        self.assertIn("HTTP 404", first["note"])


if __name__ == "__main__":
    unittest.main()
