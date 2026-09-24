import json
import os

from dotenv import load_dotenv

from github_stats.api import fetch_profile_stats


def main():
    # Not GITHUB_TOKEN: Actions reserves that name for its bot token, which can't read your profile
    load_dotenv()
    token = os.environ.get("GH_STATS_TOKEN")
    if not token:
        raise SystemExit("GH_STATS_TOKEN is not set")
    include_private = os.environ.get("INCLUDE_PRIVATE_REPO", "").strip().lower() in ("1", "true", "yes")
    stats = fetch_profile_stats(token, include_private=include_private)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
