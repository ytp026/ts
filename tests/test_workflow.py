from pathlib import Path
import unittest


class WorkflowTests(unittest.TestCase):
    def test_ticket_schedule_due_guard_and_shared_publish_lock(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / ".github/workflows/refresh-ticket-policies.yml").read_text()
        for required in [
            "schedule:", 'cron: "17 13 * * *"', "workflow_dispatch:", "push:",
            "if: github.ref_name == github.event.repository.default_branch",
            "contents: write", "pages: write", "cancel-in-progress: false",
            "python scripts/refresh_ticket_policies.py\n",
            "python scripts/refresh_ticket_policies.py --force",
            'if [ "$EVENT_NAME" = "schedule" ]',
            "git add ticket-access-data.json",
            "node --test tests/rush.test.js",
            "python scripts/publish_pages.py", "--skip-if-built",
        ]:
            self.assertIn(required, workflow)
        for file in ["refresh-ticket-policies.yml", "refresh-broadway.yml"]:
            self.assertIn("group: broadway-site-refresh", (root / ".github/workflows" / file).read_text())
        publishing_step = workflow.split("- name: Verify or retry branch-based GitHub Pages")[1]
        self.assertNotIn("if:", publishing_step)
        self.assertTrue((root / "scripts/refresh_ticket_policies.py").is_file())

    def test_required_refresh_and_publishing_sources_are_present(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / ".github/workflows/refresh-broadway.yml").read_text()
        for required in [
            "push:", "schedule:", "workflow_dispatch:",
            'cron: "0 23 * * 2,4"',
            "if: github.ref_name == github.event.repository.default_branch",
            "contents: write", "pages: write", 'node-version: "24"',
            "python scripts/refresh_broadway.py",
            "python scripts/publish_pages.py", "node --test",
        ]:
            self.assertIn(required, workflow)
        publishing_step = workflow.split("- name: Rebuild and verify branch-based GitHub Pages")[1]
        self.assertNotIn("if:", publishing_step)
        self.assertIn('$(git rev-parse HEAD)', publishing_step)
        for required in [
            "scripts/refresh_broadway.py", "scripts/publish_pages.py",
            "broadway-weekly-data.json", "tests/test_refresh_broadway.py",
            "tests/test_publish_pages.py"
        ]:
            self.assertTrue((root / required).is_file(), f"Missing deployable source: {required}")


if __name__ == "__main__":
    unittest.main()
