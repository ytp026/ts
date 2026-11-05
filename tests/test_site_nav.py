import re
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PAGES = ["index.html", "history.html", "theatres.html", "tony-awards.html", "tony-study.html",
         "rush.html", "game.html", "memories.html", "models.html"]


def nav(page):
    html = (ROOT / page).read_text(encoding="utf-8")
    match = re.search(r"<nav class=\"navigation\".*?</nav>", html, re.S)
    return html, match.group(0)


class SiteNavTests(unittest.TestCase):
    def test_every_page_links_to_every_page_once(self):
        for page in PAGES:
            with self.subTest(page=page):
                _, block = nav(page)
                links = re.findall(r"href=\"([^\"#]+\.html)\"", block)
                self.assertCountEqual(links, PAGES)

    def test_current_page_is_marked(self):
        groups = {
            "nav-viz": {"index.html", "history.html", "theatres.html", "tony-awards.html"},
            "nav-study": {"tony-study.html", "models.html"},
            "nav-fun": {"rush.html", "game.html", "memories.html"},
        }
        for page in PAGES:
            with self.subTest(page=page):
                _, block = nav(page)
                current = re.findall(r"href=\"([^\"]+)\" aria-current=\"page\"", block)
                self.assertEqual(current, [page])
                group = next(name for name, pages in groups.items() if page in pages)
                self.assertRegex(block, rf'nav-trigger active" type="button" aria-expanded="false" aria-controls="{group}"')
                self.assertEqual(len(re.findall(r"nav-trigger active", block)), 1)

    def test_menu_collapses_into_three_categories(self):
        groups = {
            "nav-viz": ("Data Viz", ["index.html", "history.html", "theatres.html", "tony-awards.html"]),
            "nav-study": ("Behind the Numbers", ["tony-study.html", "models.html"]),
            "nav-fun": ("Just for fun", ["rush.html", "game.html", "memories.html"]),
        }
        for page in PAGES:
            with self.subTest(page=page):
                html, block = nav(page)
                triggers = re.findall(r'class="nav-link nav-trigger(?: active)?"', block)
                self.assertEqual(len(triggers), 3)
                for gid, (label, hrefs) in groups.items():
                    self.assertIn(f">{label}</button>", block)
                    chunk = block.split(f'id="{gid}"', 1)[1].split("</ul>", 1)[0]
                    for href in hrefs:
                        self.assertIn(f'href="{href}"', chunk)
                self.assertIn(">Menu</span>", block)
                self.assertIn("aria-controls=\"nav-menu\"", block)
                self.assertIn("src=\"nav.js", html)


if __name__ == "__main__":
    unittest.main()
