import re
from pathlib import Path
import unittest


CSS = (Path(__file__).resolve().parents[1] / "styles.css").read_text(encoding="utf-8")


def contrast(foreground, background):
    def luminance(color):
        channels = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        linear = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
                  for c in channels]
        return sum(c * weight for c, weight in zip(linear, (.2126, .7152, .0722)))

    values = sorted((luminance(foreground), luminance(background)))
    return (values[1] + .05) / (values[0] + .05)


class TextContrastTests(unittest.TestCase):
    def test_legacy_cream_copy_uses_surface_appropriate_tokens(self):
        selectors = {
            ".reading-card p": "--ink",
            ".table-filter-hint": "--ink",
            ".history-seasonality-method": "--ink",
            ".dashboard-bars > button": "--ink",
            ".tony-change-panel > p": "--ink",
            ".secondary-button": "--inverse-ink",
            ".tony-category-filter-panel > p": "--ink",
            ".history-premise-panel > p:last-child": "--ink",
            ".tony-impact-heading p": "--ink",
            ".tony-change-ranking > button > span:first-child > i": "--inverse-ink",
            ".tony-trend-summary #tony-trend-summary": "--ink",
        }
        for selector, token in selectors.items():
            with self.subTest(selector=selector):
                rule = re.search(re.escape(selector) + r"\s*\{([^}]+)\}", CSS)
                self.assertIsNotNone(rule)
                self.assertIn(f"color: var({token});", rule.group(1))
        self.assertRegex(CSS, r"\.pbi-axis-text\s*\{\s*fill: var\(--ink\);")

    def test_normal_text_meets_aa_on_each_affected_surface(self):
        ink = re.findall(r"--ink:\s*(#[0-9A-Fa-f]{6})", CSS)[-1]
        inverse = re.findall(r"--inverse-ink:\s*(#[0-9A-Fa-f]{6})", CSS)[-1]
        pairs = [(ink, "#FFFFFF"), (ink, "#F7F8FC")]
        pairs += [("#1E292E", surface) for surface in (
            "#3EC6E0", "#F2C14E",
            "#F07167", "#B18CFF", "#3DDC97", "#F8F0C0",
        )] + [(inverse, "#24343C"), ("#1E292E", "#6E94A3")]
        for foreground, background in pairs:
            with self.subTest(foreground=foreground, background=background):
                self.assertGreaterEqual(contrast(foreground, background), 4.5)

    def test_bar_label_states_match_existing_backgrounds(self):
        self.assertRegex(
            CSS,
            r"\.dashboard-bars > button:focus-visible\s*\{"
            r"\s*background: var\(--soft\);\s*color: var\(--ink\);",
        )
        self.assertRegex(
            CSS,
            r"\.dashboard-bars > button\.selected\s*\{"
            r"\s*background: #E7E4FF;\s*color: var\(--ink\);",
        )
        self.assertRegex(
            CSS,
            r"\.history-gross-tile \.history-gross-copy > span\s*\{"
            r"\s*margin-top: \.25rem;\s*color: #1E292E;",
        )

    def test_navigation_text_meets_aa_in_all_neutral_states(self):
        for token in ("--nav-ink", "--nav-muted"):
            color = re.findall(re.escape(token) + r":\s*(#[0-9A-Fa-f]{6})", CSS)[-1]
            for background in ("#FFFFFF", "#F3F4F6", "#E5E7EB"):
                with self.subTest(token=token, background=background):
                    self.assertGreaterEqual(contrast(color, background), 4.5)

    def test_navigation_has_no_colored_group_blocks(self):
        navigation = CSS.split("/* Neutral navigation stays separate", 1)[1]
        navigation = navigation.split("section#game-board", 1)[0]
        self.assertNotIn("--nav-hint", navigation)
        self.assertIn("border-top: 1px solid var(--nav-active);", navigation)
        self.assertIn("background: var(--nav-hover);", navigation)
        self.assertIn("box-shadow: none;", navigation)

    def test_light_theme_text_and_actions_meet_aa(self):
        light = CSS.split("/* Light studio theme:", 1)[1]
        tokens = dict(re.findall(r"(--[\w-]+):\s*(#[0-9A-Fa-f]{6})", light))
        for token in ("--ink", "--muted", "--accent-dark"):
            for background in ("#FFFFFF", "#F7F8FC", "#F4F6FC", "#EEF1FB", "#E7E4FF"):
                with self.subTest(token=token, background=background):
                    self.assertGreaterEqual(contrast(tokens[token], background), 4.5)
        for token in ("--accent", "--accent-dark"):
            self.assertGreaterEqual(contrast("#FFFFFF", tokens[token]), 4.5)
        for foreground in ("#0F6B45", "#9B2331"):
            self.assertGreaterEqual(contrast(foreground, "#F7F8FC"), 4.5)
        self.assertIn("background: var(--accent);", light)
        self.assertNotIn("#6E7686", light)

    def test_legends_separate_labels_from_series_swatches(self):
        self.assertIn(".ml-legend-item { color: var(--ink); }", CSS)
        self.assertIn("background: var(--series, var(--g, currentColor));", CSS)
        self.assertIn("background: var(--series, currentColor);", CSS)
        for name, color in (("actual", "#3EC6E0"), ("model", "#F2C14E"),
                            ("baseline", "#B18CFF")):
            self.assertIn(
                f".ml-legend-item.{name}, .ml-tooltip .{name} {{ --series: {color}; }}",
                CSS,
            )
            self.assertRegex(CSS, rf"\.ml-line\.{name} \{{ stroke: {color};")
        for name in ("g-not", "g-lost", "g-won"):
            self.assertNotRegex(
                CSS, rf"\.ml-legend-item\.{name}\s*\{{[^}}]*color: var\(--g\)"
            )

    def test_form_controls_use_light_surfaces(self):
        for selector in (".impact-search input", ".pbi-filter select",
                         ".memory-admin-records-heading input"):
            rule = re.search(re.escape(selector) + r"\s*\{([^}]+)\}", CSS)
            self.assertIsNotNone(rule)
            self.assertIn("color: var(--ink);", rule.group(1))
            self.assertIn("background: var(--white);", rule.group(1))

    def test_shared_typography_uses_consistent_fonts_and_readable_sizes(self):
        body_font = re.findall(r"--font-body:\s*([^;]+)", CSS)[-1]
        display_font = re.findall(r"--font-display:\s*([^;]+)", CSS)[-1]
        self.assertEqual(body_font, '"Inter", "Segoe UI", Arial, sans-serif')
        self.assertEqual(display_font, '"Playfair Display", Georgia, serif')
        typography = CSS.split("/* Shared type scale:", 1)[1]
        self.assertIn("body { font-size: 1rem; line-height: 1.6; }", typography)
        self.assertIn("h3, h4 { font-family: var(--font-body);", typography)
        self.assertIn("font-size: .875rem;", typography)
        self.assertIn(".ml-chart text { font-size: 14px; }", typography)
        self.assertIn("min-width: var(--chart-min-width);", typography)
        self.assertIn("overflow-x: auto;", typography)


if __name__ == "__main__":
    unittest.main()
