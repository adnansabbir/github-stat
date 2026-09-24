# github-stats

Your GitHub profile stats (repos, stars, languages, yearly contributions), refreshed every week
by GitHub Actions and published as a JSON endpoint on GitHub Pages that you can reuse anywhere.

## Get your own stats

Everything runs in your own fork, with your own token, on your own GitHub account. No server, no
install, nothing to run locally.

### 1. Fork this repo

Click **Fork** at the top of this page. (If you find it useful, a ⭐ is much appreciated!)

From here on, you can keep following this README from your fork.

### 2. Create a GitHub token

The workflow needs a token to read your profile. It is created in your account, stored only in
your fork's secrets, and never leaves your repository.

1. Open [Settings → Developer settings → Fine-grained tokens → Generate new token](https://github.com/settings/personal-access-tokens/new).
2. **Token name:** anything, e.g. `github-stats`.
3. **Expiration:** your choice. When it expires, create a new one and replace the secret (step 3).
4. **Repository access:**
   - **Public repositories** for public stats only (enough for most people), or
   - **All repositories** if you also want private repos counted (see step 4). Then under
     **Permissions → Repository permissions**, set **Contents** to **Read-only**.
5. Click **Generate token** and copy it. GitHub shows it only once.

The token is read-only: it can read your profile and repos, but cannot change anything.

### 3. Add the token to your fork

In your fork, go to **Settings → Secrets and variables → Actions → New repository secret**:

- **Name:** `GH_STATS_TOKEN`
- **Secret:** the token you just copied

### 4. (Optional) Include private repos

By default only public repos and public contributions are counted. To include private ones, in
the same page open the **Variables** tab → **New repository variable**:

- **Name:** `INCLUDE_PRIVATE_REPO`
- **Value:** `true`

Private repos only add to the totals, which are published on your public page and `stats.json`.
Their names are never published.

### 5. Turn on GitHub Pages

In your fork, go to **Settings → Pages** and set **Source** to **GitHub Actions**.

### 6. Enable the workflow and run it

GitHub disables workflows in forks until you allow them:

1. Open the **Actions** tab and click **I understand my workflows, go ahead and enable them**.
2. Select **Fetch GitHub stats** → **Run workflow**.

After about a minute, your stats are live at:

| What              | URL                                                        |
|-------------------|------------------------------------------------------------|
| Shareable card    | `https://<your-username>.github.io/github-stat/`           |
| JSON endpoint     | `https://<your-username>.github.io/github-stat/stats.json` |

They refresh automatically every Sunday at 00:00 UTC. You can also refresh them any time with
**Run workflow**. Nothing is committed to your repo: each run publishes a fresh copy of the site.

If you rename your fork, replace `github-stat` in the URLs with the new name.

## What's in the JSON

| Section                | What it contains                                                   |
|------------------------|--------------------------------------------------------------------|
| `generated_at`         | When the stats were fetched (UTC, ISO 8601)                        |
| `include_private`      | Whether private repos and contributions were counted               |
| `profile`              | Name, bio, company, location, avatar, profile URL, join date, …    |
| `followers`            | Follower and following counts                                      |
| `repos`                | Owned repos: total, sources and forks                              |
| `stars`                | Stars across owned non-fork repos                                  |
| `languages`            | Bytes of code per language across non-fork repos, with percentages |
| `yearly_contributions` | Contributions per calendar year since the account was created      |

Data comes from the [GitHub GraphQL API](https://docs.github.com/en/graphql).

Without private repos, yearly contributions count commits, issues, pull requests, reviews and
created repos in public repos. GitHub lists at most 100 repos per contribution type per year, so a
year spread over more repos is slightly undercounted.

## Configuration

| Name                   | Where                        | Required | Default | Description                                            |
|------------------------|------------------------------|----------|---------|--------------------------------------------------------|
| `GH_STATS_TOKEN`       | Actions secret / `.env`      | yes      |         | Your fine-grained personal access token                |
| `INCLUDE_PRIVATE_REPO` | Actions variable / `.env`    | no       | `false` | `true` to count private repos and private contributions |

The token is not named `GITHUB_TOKEN` because GitHub Actions reserves that name for its own bot
token, which cannot read your profile.

## Run locally (optional)

Only needed if you want to change the code.

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in GH_STATS_TOKEN
python -m github_stats # prints the stats as JSON
```

To preview the card, build the site the same way the workflow does and serve it:

```sh
mkdir -p site && cp -r web/. site/
python -m github_stats > site/stats.json   # your real stats (needs GH_STATS_TOKEN)
# or: cp sample-stats.json site/stats.json # made-up data, no token needed
python -m http.server -d site 8000         # open http://localhost:8000
```

After editing `web/`, run `cp -r web/. site/` again and refresh.

The card lives in `web/` (`index.html`, `style.css`, `app.js`); `site/` is build output and is
not committed.
