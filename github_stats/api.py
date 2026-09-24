import time
from collections import Counter
from datetime import datetime, timezone

import requests

GRAPHQL_URL = "https://api.github.com/graphql"
TIMEOUT = 30
RETRY_DELAYS = (2, 5, 10)

REPO_FIELDS = """
  pageInfo { hasNextPage endCursor }
  nodes {
    isFork
    stargazerCount
    languages(first: 100, orderBy: {field: SIZE, direction: DESC}) {
      edges { size node { name color } }
    }
  }
"""

# $privacy: PUBLIC for public repos only, null for every repo the token can see
PROFILE_QUERY = f"""
query($privacy: RepositoryPrivacy) {{
  viewer {{
    name
    email
    bio
    company
    location
    websiteUrl
    twitterUsername
    avatarUrl
    url
    isHireable
    createdAt
    updatedAt
    followers {{ totalCount }}
    following {{ totalCount }}
    repositories(first: 100, ownerAffiliations: OWNER, privacy: $privacy) {{
      totalCount
      {REPO_FIELDS}
    }}
    contributionsCollection {{ contributionYears }}
  }}
}}
"""

REPOS_QUERY = f"""
query($cursor: String, $privacy: RepositoryPrivacy) {{
  viewer {{
    repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, privacy: $privacy) {{
      {REPO_FIELDS}
    }}
  }}
}}
"""

PROFILE_FIELDS = (
    "name", "email", "bio", "company", "location", "websiteUrl", "twitterUsername",
    "avatarUrl", "url", "isHireable", "createdAt", "updatedAt",
)


def _post(token, query, variables):
    for delay in (*RETRY_DELAYS, None):
        try:
            response = requests.post(
                GRAPHQL_URL,
                headers={"Authorization": f"Bearer {token}"},
                json={"query": query, "variables": variables or {}},
                timeout=TIMEOUT,
            )
            if response.status_code < 500 or delay is None:
                return response
        except (requests.ConnectionError, requests.Timeout):
            if delay is None:
                raise
        time.sleep(delay)


def _graphql(token, query, variables=None):
    response = _post(token, query, variables)
    response.raise_for_status()
    payload = response.json()
    # GraphQL reports query errors with a 200 status, in an "errors" key
    if payload.get("errors"):
        raise RuntimeError(f"GitHub GraphQL error: {payload['errors']}")
    return payload["data"]


def _all_repos(token, first_page, privacy):
    repos = list(first_page["nodes"])
    page_info = first_page["pageInfo"]
    while page_info["hasNextPage"]:
        page = _graphql(token, REPOS_QUERY, {"cursor": page_info["endCursor"], "privacy": privacy})["viewer"]["repositories"]
        repos.extend(page["nodes"])
        page_info = page["pageInfo"]
    return repos


def _languages(repos):
    sizes = Counter()
    colors = {}
    for repo in repos:
        if repo["isFork"]:
            continue
        for edge in repo["languages"]["edges"]:
            name = edge["node"]["name"]
            sizes[name] += edge["size"]
            colors[name] = edge["node"]["color"]
    total = sum(sizes.values()) or 1  # repos can report only 0-byte languages
    return [
        {"name": name, "color": colors[name], "bytes": size, "percent": round(100 * size / total, 2)}
        for name, size in sizes.most_common()
    ]


# GitHub caps each list at 100 repos, so a year spread over more repos is undercounted
PUBLIC_CONTRIBUTION_FIELDS = """
  commitContributionsByRepository(maxRepositories: 100) { repository { isPrivate } contributions { totalCount } }
  issueContributionsByRepository(maxRepositories: 100) { repository { isPrivate } contributions { totalCount } }
  pullRequestContributionsByRepository(maxRepositories: 100) { repository { isPrivate } contributions { totalCount } }
  pullRequestReviewContributionsByRepository(maxRepositories: 100) { repository { isPrivate } contributions { totalCount } }
  repositoryContributions(first: 100) { nodes { repository { isPrivate } } }
"""


def _public_contributions(collection):
    total = sum(
        entry["contributions"]["totalCount"]
        for key in (
            "commitContributionsByRepository",
            "issueContributionsByRepository",
            "pullRequestContributionsByRepository",
            "pullRequestReviewContributionsByRepository",
        )
        for entry in collection[key]
        if not entry["repository"]["isPrivate"]
    )
    # Each repo created counts as one contribution
    total += sum(not node["repository"]["isPrivate"] for node in collection["repositoryContributions"]["nodes"])
    return total


def _yearly_contributions(token, years, include_private):
    if not years:
        return {}
    # The calendar total always includes private work, so public-only counts are summed per repo
    selection = "contributionCalendar { totalContributions }" if include_private else PUBLIC_CONTRIBUTION_FIELDS
    fields = "\n".join(
        f'y{year}: contributionsCollection(from: "{year}-01-01T00:00:00Z", to: "{year}-12-31T23:59:59Z") '
        f"{{ {selection} }}"
        for year in years
    )
    viewer = _graphql(token, f"query {{ viewer {{ {fields} }} }}")["viewer"]
    if include_private:
        return {year: viewer[f"y{year}"]["contributionCalendar"]["totalContributions"] for year in years}
    return {year: _public_contributions(viewer[f"y{year}"]) for year in years}


def fetch_profile_stats(token, include_private=False):
    """Private repos only feed the totals; nothing identifying them is returned."""
    privacy = None if include_private else "PUBLIC"
    viewer = _graphql(token, PROFILE_QUERY, {"privacy": privacy})["viewer"]
    repos = _all_repos(token, viewer["repositories"], privacy)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "include_private": include_private,
        "profile": {field: viewer[field] for field in PROFILE_FIELDS},
        "followers": {
            "followers": viewer["followers"]["totalCount"],
            "following": viewer["following"]["totalCount"],
        },
        "repos": {
            "total": viewer["repositories"]["totalCount"],
            "sources": sum(not repo["isFork"] for repo in repos),
            "forks": sum(repo["isFork"] for repo in repos),
        },
        "stars": sum(repo["stargazerCount"] for repo in repos if not repo["isFork"]),
        "languages": _languages(repos),
        "yearly_contributions": _yearly_contributions(
            token, viewer["contributionsCollection"]["contributionYears"], include_private
        ),
    }
