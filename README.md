# repo-search

A "Google for repositories": find **free, open-source alternatives** to any program, or **tools and plugins by what they do**. Type in English or Spanish — Spanish is translated to English offline, no AI or API keys needed.

**Live:** https://inigo99.github.io/repo-search/

| You type | It searches |
|---|---|
| `Adobe Acrobat` | open-source alternatives to Adobe Acrobat (pdf editor) |
| `alternativa gratuita a Photoshop` | alternatives to Photoshop (image editor) |
| `plugin de obsidian para calendario` | `plugin obsidian calendar` |
| `gestor de contraseñas autoalojado` | `password manager self-hosted` |

## Features

- **Platform filters:** Windows, macOS, Linux (desktop) and Android, iOS (mobile). Pick several to see results that run on any of them.
- **Sorting:** best match, most stars or recently updated.
- **Saved tab:** save any result into one or more categories you create (e.g. *PDF tools*, *Work*). Saved repos live in your browser; use **Export / Import** to move them to another device.
- **Shareable searches:** the URL keeps the query, platforms and sort (e.g. `?q=pdf+editor&p=windows,linux&sort=stars`).

## How it works

1. **Query parsing** (`core.js`): normalises accents, translates Spanish words and phrases with `data/es-en.json`, and detects known proprietary apps with `data/apps.json` (e.g. *Acrobat → pdf editor*).
2. **Curated results** from `data/index.json` (~3,000 projects), built from
   [awesome-oss-alternatives](https://github.com/RunaCapital/awesome-oss-alternatives),
   [open-source-alternatives (btw)](https://github.com/btw-so/open-source-alternatives),
   [instead-of](https://github.com/flick9000/instead-of),
   [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted),
   [awesome-open-source-saas-alternatives](https://github.com/Anil-matcha/awesome-open-source-saas-alternatives) and
   [open-source-alternatives (OpenAlternative)](https://github.com/piotrkulpinski/open-source-alternatives).
   Each repo is enriched with stars, last update and **platforms**, detected from its latest release files (`.exe` → Windows, `.dmg` → macOS, `.AppImage`/`.deb` → Linux, `.apk` → Android, `.ipa` → iOS) and its topics.
3. **Live GitHub search** via the GitHub Search API, retrying with shorter queries when a long one returns nothing. With platform filters, each platform is searched separately (GitHub has no platform filter).

The page is static (GitHub Pages). A GitHub Action rebuilds the index every Monday.

## GitHub token (optional, recommended)

Without a token GitHub allows about **10 searches per minute** per IP. Searching with several platform filters uses one request per platform, so you will hit that limit quickly. A personal token raises it to 30 per minute, and it needs **no permissions at all**.

### 1. Create the token

1. Sign in to GitHub and open **[Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token](https://github.com/settings/personal-access-tokens/new)**.
2. **Token name:** `repo-search`.
3. **Expiration:** whatever you prefer (e.g. 1 year). When it expires, repeat these steps.
4. **Repository access:** leave **Public repositories (read-only)**.
5. **Permissions:** don't add any. Searching public repositories needs none.
6. Click **Generate token** and copy it (it starts with `github_pat_`). GitHub only shows it once.

### 2. Add it to the website

1. Open https://inigo99.github.io/repo-search/
2. Scroll to the bottom and expand **GitHub token (optional)**.
3. Paste the token and click anywhere outside the box. It is saved automatically.

The token is stored only in your browser (`localStorage`) and is only sent to `api.github.com`. Each browser or device needs it once.

### 3. Add it to the CLI or the AI skill

Set the `GITHUB_TOKEN` environment variable before running the CLI:

```bash
# macOS / Linux
export GITHUB_TOKEN=github_pat_xxx
```

```powershell
# Windows PowerShell
$env:GITHUB_TOKEN = "github_pat_xxx"
```

### Tips

- Don't commit the token or paste it into sites you don't trust, even though it has no permissions.
- To revoke it, go to **Settings → Developer settings → Fine-grained tokens** and delete `repo-search`.
- If you see *"GitHub rate limit reached"*, wait a minute or add/renew the token.

## Use it

- **Web:** open the live site, or serve locally with `python3 -m http.server` and visit http://localhost:8000
- **CLI (Node 18+):**
  ```bash
  node cli.js "alternativa a Adobe Acrobat"
  node cli.js "editor de vídeo" --platform windows,linux --sort stars --limit 5
  node cli.js "notas" --platform android --json
  ```
- **AI skill:** copy `skill/repo-search/` into your skills folder (e.g. `~/.claude/skills/`). The agent then runs the CLI and summarises the results.

## Develop

```bash
GITHUB_TOKEN=github_pat_xxx python3 scripts/build_index.py   # rebuild data/index.json (token enables stars/platforms)
node test.js                                                 # offline tests
```

To improve results, add Spanish words to `data/es-en.json` or apps to `data/apps.json` (`"app name": "what it does"`).

## Limits

- Platforms of curated entries come from release files and topics; projects without releases or topics (or linked only by website) are hidden when a platform filter is on.
- GitHub results are matched by the platform name appearing in the repo name, description or topics.
- Translation is word-by-word with a dictionary; unknown Spanish words pass through unchanged.
- Saved repos are per browser. Export them before clearing browser data.

## License

MIT
