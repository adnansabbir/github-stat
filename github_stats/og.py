"""Add the social preview to a built site: `SITE_URL=<site url> python -m github_stats.og site`.

LinkedIn and Facebook build link previews from og: meta tags without running JavaScript, so the
card is rendered to a static card.png and the tags are written into index.html with absolute URLs.

Exit codes:
  0  preview written, or skipped because the rendering tools failed (text-only tags are written,
     so the fresh stats.json and page still deploy)
  1  the card itself is broken (profile or avatar failed): nothing is written and the workflow
     stops, so the last good site stays live
"""

import functools
import html
import json
import os
import sys
import threading
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# The size LinkedIn and Facebook recommend; 1x keeps the PNG under WhatsApp's 600 KB preview limit
WIDTH, HEIGHT = 1200, 630
META_START, META_END = "<!--og-meta-->", "<!--/og-meta-->"


class CardError(Exception):
    """The card rendered wrong; publishing it would be worse than keeping last week's site."""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def site_url():
    """Public URL of the Pages site. The workflow passes the one from actions/configure-pages,
    which knows custom domains."""
    url = os.environ.get("SITE_URL")
    if not url:
        raise SystemExit("Set SITE_URL, e.g. SITE_URL=http://localhost:8000 python -m github_stats.og site")
    return url.rstrip("/") + "/"


def _version(stats):
    # Changes whenever the stats do, so a platform that re-scrapes the page fetches the new image
    try:
        generated_at = datetime.fromisoformat(stats["generated_at"])
    except (KeyError, TypeError, ValueError):
        generated_at = datetime.now(timezone.utc)
    return generated_at.strftime("%Y%m%d%H%M%S")


def _warn(message):
    # Shown as an annotation on the workflow run; a plain line when run locally
    print(f"::warning::{message}", file=sys.stderr)


def render_card(site):
    """Screenshot the card to site/card.png and return the page's title and description, which
    app.js writes from what it actually rendered."""
    from playwright.sync_api import sync_playwright

    handler = functools.partial(QuietHandler, directory=str(site))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT})
            # app.js hides a section with a console warning when its data is bad; surface those
            hidden = []
            page.on("console", lambda msg: msg.type == "warning" and msg.text.startswith("Hiding")
                    and hidden.append(msg.text.splitlines()[0]))

            # One retry, since a failed avatar is usually a passing hiccup of GitHub's avatar server
            for attempt in (1, 2):
                hidden.clear()
                page.goto(f"http://127.0.0.1:{server.server_port}/?og")
                # Done once app.js has finished and the avatar has settled, or the card shows an error
                page.wait_for_function(
                    "document.getElementById('card').getAttribute('aria-busy') === 'false'"
                    " && (document.getElementById('card').dataset.avatar"
                    " || document.querySelector('#bio.error'))"
                )
                # app.js also finishes loading when rendering fails; never publish the error card
                if page.locator("#bio.error").count():
                    raise CardError(f"Card failed to render: {page.locator('#bio').inner_text()}")
                if page.locator("#card[data-avatar=loaded]").count():
                    break
            else:
                raise CardError("Avatar failed to load twice")

            for message in hidden:
                _warn(message)
            page.screenshot(path=str(site / "card.png"))
            title = page.title()
            description = page.locator('meta[name="description"]').get_attribute("content")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    return title, description


def write_meta(index, page, base_url, title, description, image_url):
    tags = {
        "og:type": "website",
        "og:url": base_url,
        "og:title": title,
        "og:description": description,
    }
    if image_url:
        tags.update({
            "og:image": image_url,
            "og:image:width": str(WIDTH),
            "og:image:height": str(HEIGHT),
            "og:image:alt": title,
        })
    lines = [
        f"<title>{html.escape(title)}</title>",
        f'<meta name="description" content="{html.escape(description)}">',
        *(f'<meta property="{key}" content="{html.escape(value)}">' for key, value in tags.items()),
        f'<meta name="twitter:card" content="{"summary_large_image" if image_url else "summary"}">',
    ]
    before, _, rest = page.partition(META_START)
    _, _, after = rest.partition(META_END)
    index.write_text(before + "\n  ".join(lines) + after)


def main():
    site = Path(sys.argv[1] if len(sys.argv) > 1 else "site")
    base_url = site_url()
    stats = json.loads((site / "stats.json").read_text())
    index = site / "index.html"
    page = index.read_text()
    # Checked before rendering: index.html is only rewritten once, after a successful render
    if META_START not in page or META_END not in page:
        raise SystemExit(f"{index} has no {META_START}…{META_END} block; copy web/ into {site}/ again first")

    try:
        title, description = render_card(site)
        image_url = f"{base_url}card.png?v={_version(stats)}"
    except CardError as error:
        raise SystemExit(str(error))
    except Exception as error:  # Playwright missing, browser not installed or crashed, timeouts
        _warn(f"Social preview image skipped: {error}".splitlines()[0])
        profile = stats.get("profile") or {}
        name = profile.get("name") or str(profile.get("url", "")).rstrip("/").rsplit("/", 1)[-1] or "GitHub"
        title, description, image_url = f"{name} · GitHub Stats", f"GitHub stats of {name}", None
    write_meta(index, page, base_url, title, description, image_url)


if __name__ == "__main__":
    main()
