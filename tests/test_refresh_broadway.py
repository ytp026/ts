import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest

from scripts.refresh_broadway import OUTPUTS, WEEKLY, merge_outputs, parse_page, refresh


def page(week="2026-10-04", gross=100, total=None, previews=2):
    rows = []
    for i in range(10):
        rows.append(f"""<tr>
<td data-label="Show"><span class="data-value">Show {i}</span><span class="subtext">Theatre {i}</span></td>
<td data-label="This Week Gross"><span class="data-value">${gross}</span></td>
<td data-label="Avg Ticket"><span class="data-value">$50.25</span><span class="subtext">$100</span></td>
<td data-label="Seats Sold"><span class="data-value">700</span><span class="subtext">100</span></td>
<td data-label="Perfs"><span class="data-value">6</span><span class="subtext">{previews}</span></td>
</tr>""")
    return (f'<option value="?week={week}" selected>{week}</option>'
            f'<div class="week-total"><span class="accent">${total if total is not None else gross * 10}</span></div>'
            f'<tbody>{"".join(rows)}</tbody>')


def baseline():
    history = {"rows": [["2026-09-27", "2026", "Show 0", 500, 600, 800, 50, 1]]}
    theatres = {"rows": [["2026", "Show 0", "Theatre 0", 500, 600, 800]],
                "theatres": [["Theatre 0", "Address", "", .5, .5]]}
    overview = {"generatedAt": "2026-09-28", "productions": [{
        "show": "Show 0", "theatre": "Theatre 0", "totalGross": 500,
        "totalSeats": 600, "availableSeats": 800,
        "periods": {"before": [], "after": []}}],
        "awards": {"Show 0": {"wins": 1, "nominations": 2}}}
    return history, theatres, overview


class ParseTests(unittest.TestCase):
    def test_performances_include_previews(self):
        week, rows = parse_page(page(), "2026-10-04")
        self.assertEqual(week, "2026-10-04")
        self.assertEqual(rows[0], [week, "Show 0", "Theatre 0", 100, 700, 800, 50.25])

    def test_malformed_partial_duplicate_wrong_week_and_total_fail(self):
        invalid = [
            page(total=1001), page().replace("$50.25", "N/A"),
            page().replace("Show 1", "Show 0").replace("Theatre 1", "Theatre 0"),
            page().replace("<tbody>", "<other>"), page(week="2026-10-03"),
            page().replace(" selected", ""), page(previews=0).replace(">6<", ">0<")
        ]
        for content in invalid:
            with self.subTest(content=content[:50]), self.assertRaises(ValueError):
                parse_page(content)
        with self.assertRaises(ValueError):
            parse_page(page(), "2026-09-27")


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name, data in zip(OUTPUTS, baseline()):
            (self.root / name).write_text(json.dumps(data), encoding="utf-8")

    def read(self, name):
        return json.loads((self.root / name).read_text(encoding="utf-8"))

    def bytes(self):
        return {p.name: p.read_bytes() for p in self.root.iterdir() if p.is_file()}

    def test_refresh_noop_corrections_and_preserved_baseline(self):
        today = dt.date(2026, 10, 6)
        self.assertTrue(refresh(self.root, lambda week=None: page(), today))
        first = self.bytes()
        self.assertFalse(refresh(self.root, lambda week=None: page(), today))
        self.assertEqual(first, self.bytes())
        self.assertTrue(refresh(self.root, lambda week=None: page(gross=200), today))
        h, t, o = [self.read(name) for name in OUTPUTS]
        self.assertEqual(len(h["rows"]), 11)
        self.assertEqual(h["rows"][0], baseline()[0]["rows"][0])
        self.assertEqual(sum(r[3] for r in h["rows"]), 2500)
        self.assertEqual(sum(r[3] for r in t["rows"]), 2500)
        self.assertEqual(sum(p["totalGross"] for p in o["productions"]), 2500)
        self.assertEqual(o["awards"], baseline()[2]["awards"])
        self.assertEqual(t["theatres"], baseline()[1]["theatres"])
        self.assertEqual(self.read(WEEKLY)["baselineWeek"], "2026-09-27")

    def test_backfills_every_missing_week(self):
        requests = []
        def fetch(week=None):
            requests.append(week)
            return page(week or "2026-10-18")
        refresh(self.root, fetch, dt.date(2026, 10, 20))
        self.assertEqual(requests, [None, "2026-10-04", "2026-10-11"])
        self.assertEqual(len(self.read(WEEKLY)["rows"]), 30)

    def test_failure_never_changes_files(self):
        for fetch, today in [
            (lambda week=None: page(total=1), dt.date(2026, 10, 6)),
            (lambda week=None: page(), dt.date(2026, 10, 25)),
            (lambda week=None: page(), dt.date(2026, 10, 1)),
            (lambda week=None: page("2026-10-18") if week is None else page(),
             dt.date(2026, 10, 20))
        ]:
            with self.subTest(today=today):
                original = self.bytes()
                with self.assertRaises(ValueError):
                    refresh(self.root, fetch, today)
                self.assertEqual(original, self.bytes())

    def test_transport_failure_is_not_success(self):
        def failure(week=None):
            raise RuntimeError("source unavailable")
        original = self.bytes()
        with self.assertRaises(RuntimeError):
            refresh(self.root, failure, dt.date(2026, 10, 6))
        self.assertEqual(original, self.bytes())

    def test_full_recheck_corrects_older_weeks(self):
        today = dt.date(2026, 10, 27)
        refresh(self.root, lambda week=None: page(week or "2026-10-25"), today)
        requests = []
        def corrected(week=None):
            requests.append(week)
            return page(week or "2026-10-25", gross=200 if week == "2026-10-04" else 100)
        refresh(self.root, corrected, today, recheck_all=True)
        self.assertIn("2026-10-04", requests)
        self.assertEqual(sum(r[3] for r in self.read(OUTPUTS[0])["rows"]), 5500)

    def test_known_tony_window_corrections(self):
        h, t, o = baseline()
        o["productions"][0]["periods"]["after"] = [
            {"week": "2026-10-04", "gross": 100, "seats": 700, "availableSeats": 800}]
        records = parse_page(page())[1]
        first = merge_outputs(h, t, o, [], records)
        corrected = merge_outputs(*first, records, parse_page(page(gross=200))[1])
        self.assertEqual(corrected[2]["productions"][0]["periods"]["after"], [
            {"week": "2026-10-04", "gross": 200, "seats": 700, "availableSeats": 800}])


if __name__ == "__main__":
    unittest.main()
