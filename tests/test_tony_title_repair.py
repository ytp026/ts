import json
from pathlib import Path
import unittest

from scripts.repair_tony_titles import CATEGORIES, parse_archive


ROOT = Path(__file__).resolve().parents[1]


class TonyTitleRepairTests(unittest.TestCase):
    def test_title_is_not_replaced_by_producer_credits(self):
        source = '''
        <h2 class="category_title">1986 / Musical</h2>
        <div class="item award-item show">
        <img alt="Nominated Globe">
        <h3><i>Song &amp; Dance</i>. Produced by a producer</h3></div>
        '''
        row, = parse_archive(source)
        self.assertEqual(row[:6], ["1986", "Musical", "", "Song & Dance", 0, 1])

    def test_winner_and_modern_category(self):
        source = '''
        <h2 class="category_title">2025 / Best Revival of a Musical</h2>
        <div class="item award-item show">
        <img alt="Winner Globe"><h3>Sunset Blvd.</h3></div>
        '''
        row, = parse_archive(source)
        self.assertEqual(row[1], "Revival of a Musical")
        self.assertEqual(row[3:6], ["Sunset Blvd.", 1, 1])

    def test_missing_outcome_fails_instead_of_guessing(self):
        with self.assertRaisesRegex(ValueError, "Missing outcome"):
            parse_archive('<h2 class="category_title">2000 / Play</h2>'
                          '<div class="item award-item"><h3>Example</h3></div>')

    def test_complete_source_backed_production_titles(self):
        data = json.loads((ROOT / "tony-dashboard-data.json").read_text(encoding="utf-8"))
        rows = [r for r in data["rows"][1:] if r[1] in CATEGORIES.values()]
        evidence = json.loads((ROOT / "data" / "tony-production-provenance.json")
                              .read_text(encoding="utf-8"))
        self.assertEqual(sorted(rows), sorted(evidence["productionRecords"]))
        self.assertTrue(all(r[3].strip() for r in rows))
        self.assertEqual(len(rows), len({(r[0], r[1], r[3]) for r in rows}))
        modern = [a for a in evidence["categoryYearCounts"] if a["year"] >= 1986]
        self.assertGreater(sum(a["nonWinners"] for a in modern),
                           sum(a["winners"] for a in modern))

    def test_regenerated_result_counts_match_sample_audit(self):
        audit = json.loads((ROOT / "data" / "tony-sample-audit.json").read_text())
        results = json.loads((ROOT / "ml" / "tony-causal-results.json").read_text())
        lifecycle = results["nomination"]["lifecycle"]
        self.assertEqual({k: v["shows"] for k, v in lifecycle.items()},
                         audit["lifecycleRecordsWithAtLeastTwoPreNominationWeeks"])
        self.assertEqual(results["sample"]["winners"],
                         audit["withAtLeastThreePreAndPostWeeks"]["winners"])
        self.assertEqual(results["sample"]["losingNominees"],
                         audit["withAtLeastThreePreAndPostWeeks"]["nonWinningNominees"])


if __name__ == "__main__":
    unittest.main()
