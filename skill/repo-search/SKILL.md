---
name: repo-search
description: Find free, open-source GitHub repositories that replace a proprietary program (e.g. "alternative to Adobe Acrobat") or that do a given task, plugin or feature (e.g. "obsidian calendar plugin", "unir PDFs"). Accepts English or Spanish queries. Use when the user asks for a free/open-source alternative, a repo, tool, library or plugin that does something.
---

# Repo Search

Searches a prebuilt index (~tens of thousands of open-source repos from curated lists and
GitHub discovery, with platforms and "replaces X" data), and the live GitHub Search API when
the index finds few results. Spanish queries are translated to English automatically.

## Run

Requires Node 18+. No install step.

If the `inigo99/repo-search` repo is checked out, run from its root:

```bash
node cli.js "<user query>" --json --limit 10
```

Otherwise fetch the two script files into a scratch folder first (data files are
loaded from GitHub automatically):

```bash
mkdir -p /tmp/repo-search && cd /tmp/repo-search
curl -fsSO https://raw.githubusercontent.com/inigo99/repo-search/main/core.js
curl -fsSO https://raw.githubusercontent.com/inigo99/repo-search/main/cli.js
node cli.js "<user query>" --json --limit 10
```

Options:
- `--platform windows,macos,linux,android,ios` — only results for any of those platforms
  (use it when the user mentions a device or OS, e.g. "para Android", "on my Mac").
- `--sort match|stars|updated` — default `match` (relevance weighted by stars and freshness).
- `--live` — also search GitHub live even when the index has enough results.
- `--license permissive|copyleft`, `--language <name>`, `--active` (updated in the last 2 years)
  — use them when the user asks for a license, a programming language or maintained projects.

Set `GITHUB_TOKEN` in the environment if GitHub rate limits (10 searches/min unauthenticated;
each platform costs one extra search).

## Output (`--json`)

- `interpreted`: how the query was understood. `app` + `func` are set when it is an
  alternative search (e.g. `app: "adobe acrobat"`, `func: "pdf editor"`); `terms` are the English keywords.
- `results`: index entries, best first. Fields (optional ones may be missing): `n` name,
  `r` GitHub repo, `u` website, `d` description, `c` category, `a` products it replaces,
  `p` platforms, `st` stars, `up` last update, `l` language, `li` license, `t` topics,
  `s` source (`gh` = discovered on GitHub, otherwise a curated list), `k` 1 = awesome-list.
- `github`: live GitHub results (only when searched) with stars, language, description, topics, `updated` and
  `platforms` (the platform filters that matched it).
- `error`: set if GitHub could not be reached; index results still work.

## Answering

1. Lead with the top `results`; prefer active projects (recent `up`) with more stars. Mention when
   one comes from a curated list (`s` not `gh`).
2. Skip GitHub results that are clearly unrelated, abandoned forks, or just lists.
3. For each pick give name, link, one line on what it does, and stars if known.
4. Answer in the user's language, even though the search runs in English.
5. If nothing fits, retry once with simpler English keywords describing the task.
