# repo-search

A "Google for repositories": find **free, open-source alternatives** to any program, or **tools and plugins by what they do**. Type in English or Spanish — Spanish is translated to English offline, no AI or API keys needed.

**Live:** https://inigo99.github.io/repo-search/

| You type | It searches |
|---|---|
| `Adobe Acrobat` | open-source alternatives to Adobe Acrobat (pdf editor) |
| `alternativa gratuita a Photoshop` | alternatives to Photoshop (image editor) |
| `plugin de obsidian para calendario` | `plugin obsidian calendar` |
| `gestor de contraseñas autoalojado` | `password manager self-hosted` |

## How it works

1. **Query parsing** (`core.js`): normalises accents, translates Spanish words and phrases with `data/es-en.json`, and detects known proprietary apps with `data/apps.json` (e.g. *Acrobat → pdf editor*).
2. **Curated results** from `data/index.json` (~3,000 projects), built from:
   [awesome-oss-alternatives](https://github.com/RunaCapital/awesome-oss-alternatives),
   [open-source-alternatives (btw)](https://github.com/btw-so/open-source-alternatives),
   [instead-of](https://github.com/flick9000/instead-of),
   [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted),
   [awesome-open-source-saas-alternatives](https://github.com/Anil-matcha/awesome-open-source-saas-alternatives) and
   [open-source-alternatives (OpenAlternative)](https://github.com/piotrkulpinski/open-source-alternatives).
3. **Live GitHub search** via the GitHub Search API, retrying with shorter queries when a long one returns nothing.

The page is static (GitHub Pages). A weekly GitHub Action rebuilds the index.

## Use it

- **Web:** open the live site, or serve locally: `python3 -m http.server` and visit http://localhost:8000
- **CLI (Node 18+):** `node cli.js "alternativa a Adobe Acrobat"` (add `--json`, `--limit N`; set `GITHUB_TOKEN` for higher rate limits)
- **AI skill:** copy `skill/repo-search/` into your skills folder (e.g. `~/.claude/skills/`). The agent then runs the CLI and summarises the results.

## Develop

```bash
python3 scripts/build_index.py   # rebuild data/index.json
node test.js                      # offline tests
```

To improve results, add Spanish words to `data/es-en.json` or apps to `data/apps.json` (`"app name": "what it does"`).

## Limits

- Unauthenticated GitHub search allows ~10 requests/minute; add a token in the page (stored only in your browser).
- Translation is word-by-word with a dictionary; unknown Spanish words pass through unchanged.

## License

MIT
