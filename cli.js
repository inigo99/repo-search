#!/usr/bin/env node
// Usage: node cli.js "alternativa a adobe acrobat" [--json] [--limit 10]
//        [--platform windows,linux] [--sort match|stars|updated] [--live]
//        [--license permissive|copyleft] [--language Rust] [--active]
// Searches the prebuilt index; also searches GitHub live when the index finds
// fewer than `limit` results, or always with --live.
// Optional: GITHUB_TOKEN env var for higher rate limits.
const fs = require("fs");
const path = require("path");
const core = require("./core.js");

const REMOTE = "https://raw.githubusercontent.com/inigo99/repo-search/main/data/";

async function load(name) {
  const local = path.join(__dirname, "data", name);
  if (fs.existsSync(local)) return JSON.parse(fs.readFileSync(local, "utf8"));
  const res = await fetch(REMOTE + name);
  if (!res.ok) throw new Error(`cannot load ${name}: ${res.status}`);
  return res.json();
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const valued = new Set(["--limit", "--platform", "--sort", "--license", "--language"].map((n) => args.indexOf(n) + 1).filter(Boolean));
  const filters = { license: opt("--license") || "", language: opt("--language") || "", active: args.includes("--active") };
  const limit = Number(opt("--limit") || 10);
  const sort = opt("--sort") || "match";
  const platforms = (opt("--platform") || "").toLowerCase().split(",").filter(Boolean);
  const query = args.filter((a, i) => !a.startsWith("--") && !valued.has(i)).join(" ");
  const bad = platforms.filter((p) => !core.PLATFORMS.includes(p));
  if (!query || bad.length || !["match", "stars", "updated"].includes(sort) || !["", "permissive", "copyleft"].includes(filters.license)) {
    console.error('Usage: node cli.js "<query in English or Spanish>" [--json] [--limit N]\n' +
      `       [--platform ${core.PLATFORMS.join(",")}] [--sort match|stars|updated] [--live]\n` +
      "       [--license permissive|copyleft] [--language <name>] [--active]");
    process.exit(1);
  }
  const [dict, apps, index] = await Promise.all(["es-en.json", "apps.json", "index.json"].map(load));
  const p = core.parseQuery(query, dict, apps);
  const results = core.sortItems(core.searchIndex(p, index, Math.max(limit, 30), platforms, filters), sort).slice(0, limit);
  let github = { repos: [], queries: [] }, error = null;
  if (args.includes("--live") || results.length < limit) {
    try {
      github = await core.searchGithub(p, { token: process.env.GITHUB_TOKEN, platforms });
    } catch (e) {
      error = e.message;
    }
  }
  const known = new Set(results.map((e) => (e.r || "").toLowerCase()));
  const repos = core.sortItems(github.repos.filter((r) => !known.has(r.html_url.toLowerCase())
    && core.passesFilters({ lic: r.license?.spdx_id, lang: r.language, up: r.pushed_at }, filters)), sort).slice(0, limit).map((r) => ({
    name: r.full_name, url: r.html_url, stars: r.stargazers_count,
    language: r.language, description: r.description, topics: r.topics,
    updated: r.pushed_at, platforms: r.platforms,
  }));

  if (json) {
    console.log(JSON.stringify({ interpreted: p, results, github: repos, githubQueries: github.queries, error }, null, 2));
    return;
  }
  console.log(`Interpreted as: ${p.app ? `alternative to "${p.app}" (${p.func})` : ""} ${p.terms.join(" ")}`.trim()
    + (platforms.length ? ` — on ${platforms.join(" or ")}` : ""));
  console.log("\n## Results");
  if (!results.length) console.log("(none)");
  for (const e of results) console.log(`- ${e.n}: ${e.d || e.c || ""} — ${e.r || e.u}${e.a?.length ? ` (replaces ${e.a.join(", ")})` : ""}${e.st != null ? ` ★${e.st}` : ""}${e.p ? ` [${e.p.join(", ")}]` : ""}`);
  if (!github.queries.length && !error) return;
  console.log(`\n## Live from GitHub${github.queries.length ? ` (queries: ${github.queries.join(" | ")})` : ""}`);
  if (error) console.log(`(error: ${error})`);
  else if (!repos.length) console.log("(none)");
  for (const r of repos) console.log(`- ${r.name} ★${r.stars} [${r.language || "?"}]: ${r.description || ""} — ${r.url}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
