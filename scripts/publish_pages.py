"""Request and verify a branch-based Pages build, including unchanged-data retries."""

import argparse
import json
import subprocess
import time


def api(path, method="GET"):
    result = subprocess.run(
        ["gh", "api", "--method", method, path],
        check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def publish(repo, branch, commit, request=api, sleep=time.sleep, attempts=60, skip_if_built=False):
    path = f"repos/{repo}/pages"
    settings = request(path)
    source = settings.get("source", {})
    if (settings.get("build_type") != "legacy"
            or source.get("branch") != branch or source.get("path") != "/"):
        raise ValueError("Pages must deploy from the default branch root. "
                         "Configure an approved Actions deployment instead if using build_type=workflow.")
    previous = request(f"{path}/builds/latest")
    if skip_if_built and previous.get("commit") == commit and previous.get("status") == "built":
        print(f"Pages already built for {commit}")
        return
    previous_identity = (previous.get("created_at"), previous.get("updated_at"))
    request(f"{path}/builds", "POST")
    for _ in range(attempts):
        sleep(10)
        build = request(f"{path}/builds/latest")
        if build.get("commit") != commit:
            continue
        identity = (build.get("created_at"), build.get("updated_at"))
        # Do not confuse a previous failed build with the newly requested retry.
        if identity == previous_identity:
            continue
        if build.get("status") == "built":
            print(f"Verified Pages build for {commit}")
            return
        if build.get("status") == "errored":
            raise RuntimeError(f"Pages build failed: {build.get('error')}")
    raise TimeoutError(f"No successful Pages build for {commit} within {attempts * 10} seconds")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--branch", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--skip-if-built", action="store_true",
                        help="Avoid another build only when this exact commit is already published")
    args = parser.parse_args()
    try:
        publish(args.repo, args.branch, args.commit, skip_if_built=args.skip_if_built)
    except subprocess.CalledProcessError as error:
        parser.exit(1, f"GitHub Pages API failed: {error.stderr}\n")
