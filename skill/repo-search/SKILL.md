---
name: repo-search
description: Find free, open-source GitHub repositories that replace a proprietary program (e.g. "alternative to Adobe Acrobat") or that do a given task, plugin or feature (e.g. "obsidian calendar plugin", "unir PDFs"). Accepts English or Spanish queries. Use when the user asks for a free/open-source alternative, a repo, tool, library or plugin that does something.
---

# Repo Search

Searches curated open-source alternative lists plus the GitHub Search API.
Spanish queries are translated to English automatically (offline dictionary, no AI).

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
- `--sort match|stars|updated` — default `match`.

Set `GITHUB_TOKEN` in the environment if GitHub rate limits (10 searches/min unauthenticated;
each platform costs one extra search).

## Output (`--json`)

- `interpreted`: how the query was understood. `app` + `func` are set when it is an
  alternative search (e.g. `app: "adobe acrobat"`, `func: "pdf editor"`); `terms` are the English keywords.
- `curated`: hand-picked projects from awesome lists. Fields: `n` name, `r` GitHub repo,
  `u` website, `d` description, `c` category, `a` proprietary apps it replaces,
  `p` platforms, `st` stars, `up` last update.
- `github`: live GitHub results with stars, language, description, topics, `updated` and
  `platforms` (the platform filters that matched it).
- `error`: set if GitHub could not be reached; curated results still work.

## Answering

1. Lead with curated alternatives (they are vetted), then the best GitHub results by stars and relevance.
2. Skip GitHub results that are clearly unrelated, abandoned forks, or just lists.
3. For each pick give name, link, one line on what it does, and stars if known.
4. Answer in the user's language, even though the search runs in English.
5. If nothing fits, retry once with simpler English keywords describing the task.
