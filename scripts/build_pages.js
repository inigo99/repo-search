#!/usr/bin/env node
// Generate static, search-engine-friendly pages from data/index.json:
//   alternatives/<slug>/index.html  one page per product with 3+ alternatives
//   alternatives/index.html         A–Z list of those pages
//   sitemap.xml, robots.txt
// Usage: node scripts/build_pages.js   (run by the weekly workflow after build_index.py)
const fs = require("fs");
const path = require("path");
const core = require("../core.js");

const ROOT = path.join(__dirname, "..");
const BASE = "https://inigo99.github.io/repo-search/";
const MAX_PAGES = 400;     // products with the most alternatives first
const PER_PAGE = 25;
const MIN_RESULTS = 3;

const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s) => core.norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const PLAT = { windows: "Windows", macos: "macOS", linux: "Linux", android: "Android", ios: "iOS" };

// Products to build pages for, with the casing people write them in.
function targets(index, apps) {
  const count = new Map(), casing = new Map();
  for (const e of index) {
    for (const a of e.a || []) {
      const k = core.norm(a);
      if (k.length < 2) continue;
      count.set(k, (count.get(k) || 0) + 1);
      if (/[A-Z]/.test(a) && !casing.has(k)) casing.set(k, a.trim()); // curated lists keep real casing
    }
  }
  const names = new Set([...Object.keys(apps).filter((k) => !k.startsWith("_")),
    ...[...count.entries()].filter(([, n]) => n >= MIN_RESULTS).sort((a, b) => b[1] - a[1]).map(([k]) => k)]);
  const title = (k) => casing.get(k) || k.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return [...names].map((k) => ({ key: k, name: title(k), func: apps[k] || null }));
}

const CSS = `:root{--bg:#fbfaf7;--fg:#1c1b19;--muted:#6b6861;--line:#e4e1da;--card:#fff;--accent:#2f6f4f;--tag:#eef3ef}
@media (prefers-color-scheme:dark){:root{--bg:#131412;--fg:#ecebe6;--muted:#9c998f;--line:#2a2b28;--card:#1b1c1a;--accent:#6fbf94;--tag:#1f2a23}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 64px}a{color:var(--accent)}nav{font-size:14px;color:var(--muted)}
h1{font-size:clamp(26px,5vw,38px);letter-spacing:-.02em;margin:16px 0 4px}.sub{color:var(--muted);margin:0 0 24px}
.r{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:10px}
.r a.t{font-weight:600;font-size:17px;text-decoration:none;word-break:break-word}.r p{margin:4px 0 8px}
.m{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:13px;color:var(--muted)}.tag{background:var(--tag);color:var(--fg);padding:1px 8px;border-radius:6px}
.cta{display:inline-block;margin:20px 0;padding:10px 20px;border-radius:999px;background:var(--accent);color:var(--bg);text-decoration:none;font-weight:600}
ul.az{columns:3 180px;padding-left:18px}ul.az li{margin:2px 0}.n{color:var(--muted);font-size:13px}footer{margin-top:32px;font-size:13px;color:var(--muted)}`;

function page({ title, description, canonical, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<style>${CSS}</style>
</head>
<body><main>
${body}
<footer>Generated weekly by <a href="${BASE}">repo-search</a> from curated open-source lists and GitHub.
Data: stars, licenses and platforms as reported by GitHub.</footer>
</main></body>
</html>
`;
}

function card(e) {
  const meta = [
    e.st != null ? `<span>★ ${e.st.toLocaleString("en")}</span>` : "",
    e.l ? `<span>${esc(e.l)}</span>` : "", e.li ? `<span>${esc(e.li)}</span>` : "",
    ...(e.p || []).map((p) => `<span class="tag">${PLAT[p]}</span>`),
    e.up ? `<span>updated ${esc(e.up)}</span>` : "",
  ].filter(Boolean).join("");
  const url = e.r || e.u;
  return `<div class="r"><a class="t" href="${esc(url)}" rel="noopener">${esc(e.n)}</a>
${e.d ? `<p>${esc(e.d)}</p>` : ""}<div class="m">${meta}</div></div>`;
}

function main() {
  const index = read("index.json"), apps = read("apps.json");
  const outDir = path.join(ROOT, "alternatives");
  fs.rmSync(outDir, { recursive: true, force: true }); // products can disappear between builds
  fs.mkdirSync(outDir);

  const built = [];
  const seen = new Set();
  for (const t of targets(index, apps)) {
    if (built.length >= MAX_PAGES) break;
    const s = slug(t.name);
    if (!s || seen.has(s)) continue;
    const p = t.func ? { terms: [], app: t.key, func: t.func, alt: true } : { terms: t.key.split(" "), app: null, func: null, alt: true };
    // Only entries that say they replace the product: a page about "X alternatives" must not list X's plugins.
    const results = core.searchIndex(p, index, 200)
      .filter((e) => (e.a || []).some((a) => (" " + core.norm(a) + " ").includes(" " + t.key + " ")))
      .slice(0, PER_PAGE);
    if (results.length < MIN_RESULTS) continue;
    seen.add(s);
    const top = results.slice(0, 3).map((e) => e.n.split("/").pop()).join(", ");
    const title = `${results.length} free, open-source alternatives to ${t.name}`;
    const canonical = `${BASE}alternatives/${s}/`;
    fs.mkdirSync(path.join(outDir, s));
    fs.writeFileSync(path.join(outDir, s, "index.html"), page({
      title: `${title} | repo-search`,
      description: `Free and open-source alternatives to ${t.name}, ranked by relevance, stars and activity: ${top} and more.`,
      canonical,
      body: `<nav><a href="../../">repo-search</a> › <a href="../">Alternatives</a></nav>
<h1>Open-source alternatives to ${esc(t.name)}</h1>
<p class="sub">${title}${t.func ? ` (${esc(t.func)})` : ""}, ranked by relevance, GitHub stars and recent activity.</p>
${results.map(card).join("\n")}
<a class="cta" href="../../?q=${encodeURIComponent("alternative to " + t.key)}">Filter by platform, license or language →</a>`,
    }));
    built.push({ s, name: t.name, n: results.length });
  }

  built.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  fs.writeFileSync(path.join(outDir, "index.html"), page({
    title: "Open-source alternatives to popular software | repo-search",
    description: `Free, open-source alternatives to ${built.length} popular programs and services, from curated lists and GitHub.`,
    canonical: `${BASE}alternatives/`,
    body: `<nav><a href="../">repo-search</a> › Alternatives</nav>
<h1>Open-source alternatives</h1>
<p class="sub">${built.length} products with free, open-source replacements. Or <a href="../">search anything</a>.</p>
<ul class="az">${built.map((b) => `<li><a href="${b.s}/">${esc(b.name)}</a> <span class="n">(${b.n})</span></li>`).join("")}</ul>`,
  }));

  const urls = [BASE, `${BASE}alternatives/`, ...built.map((b) => `${BASE}alternatives/${b.s}/`)];
  fs.writeFileSync(path.join(ROOT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>
`);
  fs.writeFileSync(path.join(ROOT, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${BASE}sitemap.xml\n`);
  console.log(`wrote ${built.length} alternative pages`);
}

main();
