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

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

// A Date from stats.json's generated_at, or null; new Date(null) would be 1 January 1970
function generatedAt(stats) {
  const date = typeof stats.generated_at === "string" ? new Date(stats.generated_at) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function renderProfile(profile) {
  const login = new URL(profile.url).pathname.slice(1);
  const displayName = profile.name || login;

  document.title = `${displayName} · GitHub Stats`;
  // data-avatar tells the preview renderer (og.py) the avatar settled, and whether it loaded
  $("avatar").addEventListener("load", () => { $("card").dataset.avatar = "loaded"; }, { once: true });
  $("avatar").addEventListener("error", () => {
    $("card").dataset.avatar = "failed";
    $("avatar").replaceWith(el("span", { className: "avatar avatar-initials", textContent: initials(displayName) }));
  }, { once: true });
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
  const date = generatedAt(stats);
  if (date) return String(date.getUTCFullYear());
  return Object.keys(stats.yearly_contributions ?? {}).sort().at(-1);
}

// Renders one part of the card; if its data is missing or malformed, hides just that part
function section(element, render) {
  try {
    render();
  } catch (error) {
    element.hidden = true;
    console.warn(`Hiding ${element.id || element.className}:`, error);
  }
}

// A count from stats.json; anything else means the data is missing or malformed
function count(value) {
  if (!Number.isFinite(value)) throw new Error("not a number");
  return numberFormat.format(value);
}

// Each tile is independent, so one bad value only hides its own tile
function renderTotals(stats, year) {
  section($("stat-contributions").closest(".tile"), () => {
    if (!year) throw new Error("no contribution years");
    $("stat-contributions").textContent = count(stats.yearly_contributions[year] ?? 0);
    $("stat-contributions-label").textContent = `${year} Contributions`;
  });
  section($("stat-repos").closest(".tile"), () => {
    $("stat-repos").textContent = count(stats.repos.sources);
    // Older stats.json files have no include_private; they were public-only by default
    $("stat-repos-label").textContent = stats.include_private ? "Repos" : "Public Repos";
  });
  section($("stat-stars").closest(".tile"), () => {
    $("stat-stars").textContent = count(stats.stars);
  });
  section($("stat-followers").closest(".tile"), () => {
    $("stat-followers").textContent = count(stats.followers.followers);
  });
}

function renderLanguages(languages) {
  if (!languages.length) throw new Error("no languages");
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
  if (!yearly || typeof yearly !== "object" || Array.isArray(yearly)) throw new Error("not a year map");
  const years = Object.entries(yearly).sort(([a], [b]) => a - b);
  if (!years.length) throw new Error("no contribution years");
  // count() throws on any non-number, which hides the whole panel rather than drawing NaN bars
  const labels = years.map(([, n]) => count(n));
  const max = Math.max(1, ...years.map(([, n]) => n));

  $("years").replaceChildren(...years.map(([year, n], i) => {
    // The count sits on the bar, so the bar's height is a share of the track alone, not the labels
    const bar = el("div", { className: "year-bar", title: `${n} contributions in ${year}` }, [
      el("span", { className: "year-count", textContent: labels[i] }),
    ]);
    bar.style.height = `${(n / max) * 100}%`;
    const label = el("span", { className: "year-label", textContent: `'${year.slice(2)}` });
    if (year === current) label.append(el("span", { className: "ytd", textContent: " YTD" }));
    return el("div", { className: year === current ? "year current" : "year" }, [
      el("div", { className: "year-track" }, [bar]),
      label,
    ]);
  }));
}

// The page description, built from what the card shows; og.py copies it into the preview tags
function describe() {
  const parts = [...document.querySelectorAll("#tiles:not([hidden]) .tile:not([hidden])")].map((tile) => {
    const value = tile.querySelector(".tile-value").textContent;
    // "2026 Contributions" reads as "1.4K contributions in 2026"
    const [, year, label] = tile.querySelector(".tile-label").textContent.toLowerCase().match(/^(?:(\d{4}) )?(.*)$/);
    return year ? `${value} ${label} in ${year}` : `${value} ${label}`;
  });
  if (!$("panel-languages").hidden) {
    const top = [...document.querySelectorAll("#lang-legend li > span:nth-child(2)")]
      .map((span) => span.textContent).filter((name) => name !== "Other").slice(0, 3);
    if (top.length) parts.push(`Top: ${top.join(", ")}`);
  }
  const description = parts.join(" · ") || `GitHub stats of ${$("name").textContent}`;
  document.querySelector('meta[name="description"]').content = description;
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
  // ?og lays the card out at 1200x630 for the social preview screenshot
  if (new URLSearchParams(location.search).has("og")) document.body.classList.add("og");
  setUpSharing();
  try {
    const response = await fetch("stats.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`stats.json returned ${response.status}`);
    const stats = await response.json();

    // Without a profile there is no card to show, so this one is not optional
    renderProfile(stats.profile);

    const year = currentYear(stats);
    renderTotals(stats, year);
    $("tiles").hidden = !$("tiles").querySelector(".tile:not([hidden])");
    section($("panel-languages"), () => renderLanguages(stats.languages));
    section($("panel-years"), () => renderYears(stats.yearly_contributions, year));

    const date = generatedAt(stats);
    if (date) $("updated").textContent = `Updated ${dateFormat.format(date)}`;
    describe();
  } catch (error) {
    $("name").textContent = "Stats unavailable";
    $("bio").textContent = String(error.message);
    $("bio").classList.add("error");
  } finally {
    $("card").setAttribute("aria-busy", "false");
  }
}

main();
