#!/usr/bin/env node
// Usage: node cli.js "alternativa a adobe acrobat" [--json] [--limit 10]
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
  const li = args.indexOf("--limit");
  const limit = li >= 0 ? Number(args[li + 1]) : 10;
  const query = args.filter((a, i) => !a.startsWith("--") && !(li >= 0 && i === li + 1)).join(" ");
  if (!query) {
    console.error('Usage: node cli.js "<query in English or Spanish>" [--json] [--limit N]');
    process.exit(1);
  }
  const [dict, apps, index] = await Promise.all(["es-en.json", "apps.json", "index.json"].map(load));
  const p = core.parseQuery(query, dict, apps);
  const curated = core.searchIndex(p, index, limit);
  let github = { repos: [], queries: [] }, error = null;
  try {
    github = await core.searchGithub(p, { token: process.env.GITHUB_TOKEN });
  } catch (e) {
    error = e.message;
  }
  const repos = github.repos.slice(0, limit).map((r) => ({
    name: r.full_name, url: r.html_url, stars: r.stargazers_count,
    language: r.language, description: r.description, topics: r.topics,
  }));

  if (json) {
    console.log(JSON.stringify({ interpreted: p, curated, github: repos, githubQueries: github.queries, error }, null, 2));
    return;
  }
  console.log(`Interpreted as: ${p.app ? `alternative to "${p.app}" (${p.func})` : ""} ${p.terms.join(" ")}`.trim());
  console.log("\n## Curated alternatives");
  if (!curated.length) console.log("(none)");
  for (const e of curated) console.log(`- ${e.n}: ${e.d || e.c} — ${e.r || e.u}${e.a.length ? ` (replaces ${e.a.join(", ")})` : ""}`);
  console.log(`\n## GitHub${github.queries.length ? ` (queries: ${github.queries.join(" | ")})` : ""}`);
  if (error) console.log(`(error: ${error})`);
  else if (!repos.length) console.log("(none)");
  for (const r of repos) console.log(`- ${r.name} ★${r.stars} [${r.language || "?"}]: ${r.description || ""} — ${r.url}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
