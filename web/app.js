// Renders the stats card from ./stats.json. Data is set with textContent only, since profile
// fields such as the bio are user-written.

const TOP_LANGUAGES = 5;
const FALLBACK_LANGUAGE_COLOR = "#8b949e";

const numberFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

// GitHub stores the website as typed, possibly without a scheme; only link http(s) URLs
function safeWebsite(value) {
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function renderProfile(profile) {
  const login = new URL(profile.url).pathname.slice(1);
  const displayName = profile.name || login;

  document.title = `${displayName} · GitHub Stats`;
  $("avatar").src = profile.avatarUrl;
  $("avatar").alt = displayName;
  $("name").textContent = displayName;
  $("login").textContent = `@${login}`;
  $("login").href = profile.url;
  $("bio").textContent = profile.bio || "";

  const meta = [];
  if (profile.company) meta.push(el("li", { textContent: profile.company }));
  if (profile.location) meta.push(el("li", { textContent: profile.location }));
  const website = safeWebsite(profile.websiteUrl);
  if (website) {
    meta.push(el("li", {}, [el("a", { href: website.href, textContent: website.host + website.pathname.replace(/\/$/, "") })]));
  }
  meta.push(el("li", { textContent: `Joined ${new Date(profile.createdAt).getUTCFullYear()}` }));
  $("meta").replaceChildren(...meta);
}

// The year the stats were fetched in, which is the one still in progress
function currentYear(stats) {
  const generatedAt = new Date(stats.generated_at);
  if (!Number.isNaN(generatedAt.getTime())) return String(generatedAt.getUTCFullYear());
  return Object.keys(stats.yearly_contributions).sort().at(-1);
}

function renderTotals(stats, year) {
  $("stat-contributions").textContent = numberFormat.format(stats.yearly_contributions[year] ?? 0);
  $("stat-contributions-label").textContent = `${year} Contributions`;
  $("stat-repos").textContent = numberFormat.format(stats.repos.sources);
  // Older stats.json files have no include_private; they were public-only by default
  $("stat-repos-label").textContent = stats.include_private ? "Repos" : "Public Repos";
  $("stat-stars").textContent = numberFormat.format(stats.stars);
  $("stat-followers").textContent = numberFormat.format(stats.followers.followers);
}

function renderLanguages(languages) {
  const top = languages.slice(0, TOP_LANGUAGES);
  const otherPercent = languages.slice(TOP_LANGUAGES).reduce((sum, lang) => sum + lang.percent, 0);
  if (otherPercent > 0) {
    top.push({ name: "Other", color: FALLBACK_LANGUAGE_COLOR, percent: otherPercent });
  }

  $("lang-bar").replaceChildren(...top.map((lang) => {
    const segment = el("span", { title: `${lang.name} ${lang.percent.toFixed(1)}%` });
    segment.style.width = `${lang.percent}%`;
    segment.style.background = lang.color || FALLBACK_LANGUAGE_COLOR;
    return segment;
  }));

  $("lang-legend").replaceChildren(...top.map((lang) => {
    const dot = el("span", { className: "dot" });
    dot.style.background = lang.color || FALLBACK_LANGUAGE_COLOR;
    return el("li", {}, [
      dot,
      el("span", { textContent: lang.name }),
      el("span", { className: "pct", textContent: `${lang.percent.toFixed(1)}%` }),
    ]);
  }));
}

function renderYears(yearly, current) {
  const years = Object.entries(yearly).sort(([a], [b]) => a - b);
  const max = Math.max(1, ...years.map(([, count]) => count));

  $("years").replaceChildren(...years.map(([year, count]) => {
    // The count sits on the bar, so the bar's height is a share of the track alone, not the labels
    const bar = el("div", { className: "year-bar", title: `${count} contributions in ${year}` }, [
      el("span", { className: "year-count", textContent: numberFormat.format(count) }),
    ]);
    bar.style.height = `${(count / max) * 100}%`;
    const label = el("span", { className: "year-label", textContent: `'${year.slice(2)}` });
    if (year === current) label.append(el("span", { className: "ytd", textContent: " YTD" }));
    return el("div", { className: year === current ? "year current" : "year" }, [
      el("div", { className: "year-track" }, [bar]),
      label,
    ]);
  }));
}

function setUpSharing() {
  const url = encodeURIComponent(location.href);
  $("share-linkedin").href = `https://www.linkedin.com/sharing/share-offsite/?url=${url}`;
  $("share-facebook").href = `https://www.facebook.com/sharer/sharer.php?u=${url}`;
  $("copy-link").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      $("copy-link").textContent = "Copied!";
    } catch {
      $("copy-link").textContent = "Copy failed";
    }
    setTimeout(() => { $("copy-link").textContent = "Copy link"; }, 2000);
  });
}

async function main() {
  setUpSharing();
  try {
    const response = await fetch("stats.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`stats.json returned ${response.status}`);
    const stats = await response.json();

    const year = currentYear(stats);
    renderProfile(stats.profile);
    renderTotals(stats, year);
    renderLanguages(stats.languages);
    renderYears(stats.yearly_contributions, year);
    const generatedAt = new Date(stats.generated_at);
    if (!Number.isNaN(generatedAt.getTime())) {
      $("updated").textContent = `Updated ${dateFormat.format(generatedAt)}`;
    }
  } catch (error) {
    $("name").textContent = "Stats unavailable";
    $("bio").textContent = String(error.message);
    $("bio").classList.add("error");
  } finally {
    $("card").setAttribute("aria-busy", "false");
  }
}

main();
