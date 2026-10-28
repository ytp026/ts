import unittest

from scripts.publish_pages import publish


class PublishTests(unittest.TestCase):
    def test_skip_only_exact_successful_commit_and_retry_failed_builds(self):
        calls, request = self.scenario([{"commit": "abc", "status": "built"}])
        publish("owner/repo", "main", "abc", request, skip_if_built=True)
        self.assertFalse(any(method == "POST" for _, method in calls))
        for previous in [
            {"commit": "abc", "status": "errored", "created_at": "old"},
            {"commit": "other", "status": "built", "created_at": "old"},
        ]:
            calls, request = self.scenario([
                previous, {"commit": "abc", "status": "built", "created_at": "new"}])
            publish("owner/repo", "main", "abc", request, lambda _: None, 1, skip_if_built=True)
            self.assertIn(("repos/owner/repo/pages/builds", "POST"), calls)

    def scenario(self, builds, settings=None):
        calls = []
        iterator = iter(builds)
        def request(path, method="GET"):
            calls.append((path, method))
            if method == "POST":
                return {"status": "queued"}
            if path.endswith("/pages"):
                return settings or {"build_type": "legacy", "source": {"branch": "main", "path": "/"}}
            return next(iterator)
        return calls, request

    def test_unchanged_data_still_requests_and_verifies_build(self):
        calls, request = self.scenario([
            {"commit": "abc", "status": "errored", "created_at": "old"},
            {"commit": "abc", "status": "errored", "created_at": "old"},
            {"commit": "abc", "status": "building", "created_at": "new"},
            {"commit": "abc", "status": "built", "created_at": "new"}])
        publish("owner/repo", "main", "abc", request, lambda _: None, 3)
        self.assertIn(("repos/owner/repo/pages/builds", "POST"), calls)

    def test_build_failure_is_not_reported_as_success(self):
        _, request = self.scenario([
            {"commit": "old", "status": "built", "created_at": "old"},
            {"commit": "abc", "status": "errored", "created_at": "new",
             "error": {"message": "build failed"}}])
        with self.assertRaisesRegex(RuntimeError, "build failed"):
            publish("owner/repo", "main", "abc", request, lambda _: None, 1)

    def test_wrong_commit_and_unchanged_old_build_timeout(self):
        for current in [
            {"commit": "old", "status": "built", "created_at": "new"},
            {"commit": "abc", "status": "built", "created_at": "old"}
        ]:
            _, request = self.scenario([
                {"commit": "abc", "status": "built", "created_at": "old"}, current])
            with self.assertRaises(TimeoutError):
                publish("owner/repo", "main", "abc", request, lambda _: None, 1)

    def test_incompatible_pages_settings_fail_before_post(self):
        for settings in [
            {"build_type": "workflow"},
            {"build_type": "legacy", "source": {"branch": "other", "path": "/"}},
            {"build_type": "legacy", "source": {"branch": "main", "path": "/docs"}}
        ]:
            calls, request = self.scenario([], settings)
            with self.assertRaises(ValueError):
                publish("owner/repo", "main", "abc", request, lambda _: None)
            self.assertFalse(any(method == "POST" for _, method in calls))

    def test_api_failure_propagates(self):
        def failure(*args):
            raise RuntimeError("API denied")
        with self.assertRaisesRegex(RuntimeError, "API denied"):
            publish("owner/repo", "main", "abc", failure, lambda _: None)


if __name__ == "__main__":
    unittest.main()
