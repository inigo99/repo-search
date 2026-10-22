#!/usr/bin/env python3
"""Build data/index.json: curated alternative lists + repos discovered on GitHub.

Usage: GITHUB_TOKEN=... python scripts/build_index.py
Stdlib only. Run weekly by .github/workflows/update-index.yml (about 20 minutes).

With GITHUB_TOKEN set:
- discovers repos by topic (self-hosted, alternative...) and description ("alternative to"),
  plus "<app> alternative" for every app in data/apps.json;
- reads stars, last push, language, license, topics and the latest release assets;
- detects platforms (release files + topics) and the products each repo replaces
  ("open-source alternative to Notion" -> "notion").
Release checks are cached in data/release-cache.json and redone only when a repo is pushed.
Without a token, the curated lists are refreshed and GitHub data is kept from the last index.

Entry fields: n name, r repo url, u website, d description, c category, a replaces,
s source ("gh" = discovered), p platforms, st stars, up last push, l language,
li license, t topics, k 1 if it is a list (awesome-*).
"""
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RAW = "https://raw.githubusercontent.com/"
SOURCES = {
    "runa": RAW + "RunaCapital/awesome-oss-alternatives/main/README.md",
    "btw": RAW + "btw-so/open-source-alternatives/main/README.md",
    "instead-of": RAW + "flick9000/instead-of/main/README.md",
    "selfhosted": RAW + "awesome-selfhosted/awesome-selfhosted/master/README.md",
    "saas": RAW + "Anil-matcha/awesome-open-source-saas-alternatives/main/README.md",
    "openalternative": RAW + "piotrkulpinski/open-source-alternatives/main/README.md",
}
LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
GH = re.compile(r"https?://github\.com/[\w.-]+/[\w.-]+")


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read().decode("utf-8")


def repo(text):
    m = GH.search(text or "")
    return m.group(0).rstrip(".").removesuffix(".git") if m else None


def entry(name, url, desc, cat, alt, src):
    return {"n": name.strip(), "u": url, "r": repo(url), "d": desc.strip(),
            "c": cat.strip(), "a": [a.strip() for a in alt if a.strip()], "s": src}


def parse_runa(md):
    # Category|[Name](site)|Description|<a href=github...>|[Prop](...), [Prop](...)
    out = []
    for line in md.splitlines():
        cols = line.strip().strip("|").split("|")
        if len(cols) < 5 or not LINK.search(cols[1]):
            continue
        name, url = LINK.search(cols[1]).groups()
        alts = [n for n, _ in LINK.findall(cols[4])]
        e = entry(name, url, cols[2], cols[0], alts, "runa")
        e["r"] = repo(cols[3]) or e["r"]
        out.append(e)
    return out


def parse_btw(md):
    # ### Category (X, Y alternatives):  then  [Name](github)|[site](...)|...
    out, cat, alts = [], "", []
    for line in md.splitlines():
        h = re.match(r"#+\s*(.+?)\s*\((.+?) alternatives?\)", line)
        if h:
            cat, alts = h.group(1), re.split(r",|/| or ", h.group(2))
            continue
        m = LINK.match(line.strip())
        if m and cat and "|" in line:
            out.append(entry(m.group(1), m.group(2), "", cat, alts, "btw"))
    return out


def parse_instead_of(md):
    # ## Instead of X, Y   - ### [Name](url)   > description
    out, alts = [], []
    for line in md.splitlines():
        s = line.strip()
        if s.startswith("## Instead of "):
            alts = re.split(r",|/", s[len("## Instead of "):])
        elif s.startswith("- ### ") and alts:
            m = LINK.search(s)
            name, url = m.groups() if m else (s[6:], "")
            out.append(entry(name, url, "", "Instead of " + ", ".join(alts), alts, "instead-of"))
        elif s.startswith(">") and out and not out[-1]["d"]:
            out[-1]["d"] = s.lstrip("> ")
    return out


def parse_selfhosted(md):
    # ### Category   - [Name](url) - Description. ([Source Code](url)) `License` `Lang`
    out, cat = [], ""
    body = md.split("## Software", 1)[-1].split("## List of Licenses", 1)[0]
    for line in body.splitlines():
        if line.startswith("### "):
            cat = line[4:]
        m = re.match(r"- \[([^\]]+)\]\(([^)]+)\)\s*(?:`⚠`)?\s*-\s*(.*?)\s*(\(\[|`|$)", line)
        if m and cat:
            e = entry(m.group(1), m.group(2), m.group(3), cat, [], "selfhosted")
            e["r"] = repo(line) or e["r"]
            out.append(e)
    return out


def parse_saas(md):
    # ## Category  ### Proprietary app  | [Name](github) | Description | License | Stars |
    out, cat, app = [], "", ""
    for line in md.splitlines():
        if line.startswith("## "):
            cat = line[3:]
        elif line.startswith("### "):
            app = line[4:]
        elif line.startswith("| [") and app:
            cols = [c.strip() for c in line.strip("|").split("|")]
            name, url = LINK.search(cols[0]).groups()
            out.append(entry(name, url, cols[1] if len(cols) > 1 else "", cat, [app], "saas"))
    return out


def parse_openalternative(md):
    # ### Category   - [Name](openalternative.co/...) - Description `License` `⭐ 1K`
    # Lines before the first ### are sponsors, skip them.
    out, cat = [], ""
    for line in md.splitlines():
        if line.startswith("### "):
            cat = line[4:]
        m = re.match(r"- \[([^\]]+)\]\(([^)]+)\)\s*-\s*(.*?)\s*(`|$)", line)
        if m and cat:
            out.append(entry(m.group(1), m.group(2), m.group(3), cat, [], "openalternative"))
    return out


PLATFORMS = ("windows", "macos", "linux", "android", "ios")
# Release asset name (lowercase) -> platform. Checked as substrings.
ASSET_HINTS = {
    "windows": (".exe", ".msi", ".msix", ".appx", "win64", "win32", "windows", "-win.", "_win."),
    "macos": (".dmg", ".pkg", "macos", "darwin", "osx", "-mac.", "_mac.", "universal.zip"),
    "linux": (".appimage", ".deb", ".rpm", ".flatpak", ".snap", "linux"),
    "android": (".apk", ".aab", "android"),
    "ios": (".ipa",),
}
# Whole words in topics/name/description/category -> platforms.
WORD_HINTS = {
    "windows": ["windows"], "win32": ["windows"], "wpf": ["windows"], "winforms": ["windows"],
    "macos": ["macos"], "osx": ["macos"], "mac": ["macos"],
    "linux": ["linux"], "gnome": ["linux"], "kde": ["linux"], "flatpak": ["linux"],
    "android": ["android"], "ios": ["ios"], "iphone": ["ios"], "ipad": ["ios"],
    "electron": ["windows", "macos", "linux"], "tauri": ["windows", "macos", "linux"],
    "cross-platform": ["windows", "macos", "linux"], "crossplatform": ["windows", "macos", "linux"],
    "react-native": ["android", "ios"],
    "flutter": ["android", "ios"],
}


def detect_platforms(words, assets=()):
    """words: iterable of lowercase tokens/topics; assets: release asset names."""
    found = set()
    for w in words:
        found.update(WORD_HINTS.get(w, ()))
    for a in assets:
        a = a.lower()
        for p, hints in ASSET_HINTS.items():
            # "darwin"/"linux" tarballs of CLIs still run there, so substrings are fine.
            if any(h in a for h in hints):
                found.add(p)
    return [p for p in PLATFORMS if p in found]


def tokens(text):
    return re.findall(r"[a-z0-9][a-z0-9+-]*", (text or "").lower())


# ---------- "alternative to X" extraction ----------
# Leading words that describe the project, not the product it replaces.
NOT_A_PRODUCT = {
    "open", "source", "open-source", "opensource", "free", "self-hosted", "selfhosted", "self-hostable",
    "simple", "modern", "lightweight", "fast", "faster", "better", "privacy-friendly", "privacy-first",
    "privacy-focused", "local", "local-first", "minimal", "minimalist", "secure", "native", "tiny", "small",
    "an", "a", "the", "our", "your", "its", "drop-in", "libre", "foss", "decentralized", "ethical",
    "cross-platform", "offline", "community", "independent", "full", "complete", "great", "powerful", "easy",
    "open source", "easier-to-use", "ai", "saas", "proprietary", "paid", "commercial",
}
ALT_TO = re.compile(r"\b(?:alternatives?|replacements?|substitutes?)\s+(?:to|for)\s+(.+)", re.I)
ALT_BEFORE = re.compile(r"((?:[A-Z0-9][\w.+'-]*\s+){0,2}[A-Z0-9][\w.+'-]*)\s+alternative\b(?!\s+(?:to|for)\b)")
CLAUSE_END = re.compile(r"\.(?:\s|$)|[!?;:|•—–()\[\]\"“”]|\s-\s|\bthat\b|\bwhich\b|\bwith\b|\bwritten\b|\bbuilt\b|\bfor\b|\bin\b|\bon\b|\busing\b")


def _product(words):
    """Leading product-like words: capitalised or containing a digit/dot (Auth0, Moment.js)."""
    out = []
    for w in words:
        w = w.strip("'\"‘’“”,()[];:")
        w = re.sub(r"['’]s$", "", w)
        if w.lower() in NOT_A_PRODUCT and not out:
            continue
        if w[:1].isupper() or any(c.isdigit() for c in w) or ("." in w and len(w) > 3):
            out.append(w)
        else:
            break
    return " ".join(out[:4])


def extract_alternatives(desc, topics=()):
    """Product names a repo says it replaces, lowercase. Noise is fine; misses are worse."""
    found = []
    m = ALT_TO.search(desc or "")
    if m:
        clause = CLAUSE_END.split(m.group(1), maxsplit=1)[0]
        parts = [p.split() for p in re.split(r",|/|&|\+|\band\b|\bor\b|\betc\b", clause) if p.strip()]
        # Lowercase single words are CLI tool names ("alternative to 'find'", "to frp and ngrok"),
        # but only when every part is one: in "to Salesforce, designed for AI" they are prose.
        cli_names = all(len(w) == 1 and w[0].strip("'\"‘’").islower() for w in parts)
        for words in parts:
            name = _product(words)
            if not name and cli_names and len(words[0].strip("'\"‘’")) > 1:
                name = words[0].strip("'\"‘’")
            if name:
                found.append(name)
    for m in ALT_BEFORE.finditer(desc or ""):
        name = _product(m.group(1).split())
        if name:
            found.append(name)
    for t in topics:
        if t.endswith("-alternative") and len(t) > len("-alternative"):
            found.append(t[: -len("-alternative")].replace("-", " "))
    seen, out = set(), []
    for f in found:
        k = f.lower().strip(" .'-")
        if k and k not in seen and k not in NOT_A_PRODUCT:
            seen.add(k)
            out.append(k)
    return out[:6]


# ---------- GitHub access ----------
def http_json(url, token, body=None, tries=4):
    """GET (or POST body) JSON from the GitHub API, waiting out rate limits."""
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
               "User-Agent": "repo-search-index"}
    data = None
    if body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (403, 429, 502, 503) and attempt < tries - 1:
                wait = int(e.headers.get("Retry-After") or 0) or 60 * (attempt + 1)
                print(f"  {e.code}, waiting {wait}s")
                time.sleep(wait)
                continue
            raise
    return {}


# Repositories worth indexing. Each query is split by star bands because GitHub
# returns at most 1000 results per query.
DISCOVERY_QUERIES = [
    "topic:self-hosted", "topic:selfhosted", "topic:open-source-alternative", "topic:alternative",
    "topic:alternatives", "topic:foss", "topic:privacy", "topic:degoogle",
    '"alternative to" in:description', '"alternatives to" in:description',
    '"alternative for" in:description', '"replacement for" in:description',
    '"open source alternative" in:description',
]
STAR_BANDS = ["stars:>=2000", "stars:500..1999", "stars:150..499", "stars:50..149", "stars:20..49"]
MIN_STARS = 20


def rest_search(q, token, pages=10, per_page=100):
    out = []
    for page in range(1, pages + 1):
        url = (f"https://api.github.com/search/repositories?sort=stars&per_page={per_page}&page={page}&q="
               + urllib.parse.quote(q + " fork:false archived:false"))
        try:
            items = http_json(url, token).get("items", [])
        except Exception as e:  # one bad query must not kill the build
            print(f"  search failed ({q}): {e}")
            break
        out += items
        time.sleep(2.2)  # search API: 30 requests/minute with a token
        if len(items) < per_page:
            break
    return out


def discover(token, apps):
    """{repo_url_lower: REST item} for every repo matching the discovery queries."""
    queries = [(f"{q} {band}", 10) for q in DISCOVERY_QUERIES for band in STAR_BANDS]
    # Per known proprietary app: "<app> alternative", top 100 only.
    queries += [(f'"{app}" alternative stars:>={MIN_STARS}', 1) for app in sorted(apps) if not app.startswith("_")]
    repos = {}
    for i, (q, pages) in enumerate(queries):
        got = rest_search(q, token, pages=pages)
        for it in got:
            if not it.get("archived") and it["stargazers_count"] >= MIN_STARS:
                repos[it["html_url"].lower()] = it
        print(f"[{i + 1}/{len(queries)}] {q}: {len(got)} (total {len(repos)})")
    return repos


def from_rest(it):
    return {"st": it["stargazers_count"], "up": (it.get("pushed_at") or "")[:10],
            "desc": it.get("description") or "", "topics": it.get("topics") or [],
            "l": it.get("language"), "li": ((it.get("license") or {}).get("spdx_id") or "").replace("NOASSERTION", ""),
            "archived": bool(it.get("archived")), "name": it["full_name"]}


GQL_REPO = """r%d: repository(owner: %s, name: %s) {
  nameWithOwner stargazerCount pushedAt isArchived description
  primaryLanguage { name } licenseInfo { spdxId }
  repositoryTopics(first: 20) { nodes { topic { name } } }
  releases(first: 1, orderBy: {field: CREATED_AT, direction: DESC}) {
    nodes { releaseAssets(first: 50) { nodes { name } } } }
}"""


def graphql_repos(urls, token, batch=100):
    """Full info + latest release asset names for each repo URL. Stops early near the rate limit."""
    info = {}
    for i in range(0, len(urls), batch):
        chunk = urls[i:i + batch]
        parts = [GQL_REPO % (j, json.dumps(u.split("/")[3]), json.dumps(u.split("/")[4])) for j, u in enumerate(chunk)]
        query = "{ rateLimit { remaining }\n" + "\n".join(parts) + "}"
        try:
            data = http_json("https://api.github.com/graphql", token, {"query": query}).get("data") or {}
        except Exception as e:
            print(f"  graphql batch {i}: {e}")
            continue
        for j, u in enumerate(chunk):
            d = data.get(f"r{j}")
            if not d:  # renamed, deleted or private
                continue
            rel = (d["releases"]["nodes"] or [{}])[0]
            info[u] = {
                "st": d["stargazerCount"], "up": (d["pushedAt"] or "")[:10], "desc": d["description"] or "",
                "topics": [n["topic"]["name"] for n in d["repositoryTopics"]["nodes"]],
                "l": (d["primaryLanguage"] or {}).get("name"),
                "li": ((d["licenseInfo"] or {}).get("spdxId") or "").replace("NOASSERTION", ""),
                "archived": d["isArchived"], "name": d["nameWithOwner"],
                "assets": [a["name"] for a in (rel.get("releaseAssets") or {}).get("nodes", [])],
            }
        left = (data.get("rateLimit") or {}).get("remaining", 9999)
        print(f"  graphql {min(i + batch, len(urls))}/{len(urls)} (rate limit left {left})")
        if left < 50:
            print("  stopping GraphQL early: rate limit almost used up")
            break
    return info


# ---------- index assembly ----------
OUT = Path(__file__).resolve().parent.parent / "data" / "index.json"
CACHE = Path(__file__).resolve().parent.parent / "data" / "release-cache.json"


def load_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def is_list(name, topics):
    n = (name or "").lower()
    return "awesome" in n or "awesome-list" in topics or "awesome" in topics


def finalize(e, x, release_platforms):
    """Merge GitHub info x into entry e and compact it for the client."""
    if x:
        e.update({k: x[k] for k in ("st", "up", "l", "li") if x.get(k)})
        if not e["d"]:
            e["d"] = x["desc"]
        if e["s"] == "gh":
            e["n"] = x["name"]
        topics = x["topics"]
        e["a"] = list(dict.fromkeys([a for a in e["a"]] + extract_alternatives(x["desc"], topics)))
        if topics:
            e["t"] = topics[:8]
        if is_list(e["n"], topics):
            e["k"] = 1
    words = tokens(f'{e["n"]} {e["d"]} {e["c"]}') + e.get("t", [])
    p = sorted(set(detect_platforms(words)) | set(release_platforms), key=PLATFORMS.index)
    if p:
        e["p"] = p
    if len(e["d"]) > 220:
        e["d"] = e["d"][:217].rstrip() + "…"
    if e.get("u") == e.get("r"):
        e.pop("u")
    for k in [k for k, v in e.items() if v in ("", [], None)]:
        e.pop(k)
    return e


def build(curated, discovered, token, cache):
    """curated: parsed list entries; discovered: {repo_url_lower: REST item}; cache: {repo: [up, platforms]}."""
    info = {u: from_rest(it) for u, it in discovered.items()}
    # Curated repos GitHub search didn't return still need stars/topics; every repo whose
    # last push changed since the cached check needs its release assets re-read.
    all_repos = {e["r"].lower() for e in curated if e.get("r")} | set(info)
    need = sorted(u for u in all_repos if u not in info or cache.get(u, [None])[0] != info[u]["up"])
    if token and need:
        print(f"GraphQL for {len(need)} repos")
        for u, x in graphql_repos(need, token).items():
            info[u] = x
            cache[u] = [x["up"], detect_platforms((), x.pop("assets"))]
    for u in [u for u in cache if u not in all_repos]:  # forget repos no longer indexed
        del cache[u]

    items, seen = [], set()
    for e in curated:
        u = (e.get("r") or "").lower()
        x = info.get(u)
        if x and x["archived"]:
            continue
        seen.add(u)
        items.append(finalize(e, x, cache.get(u, [None, []])[1]))
    for u, x in info.items():
        if u in seen or x["archived"] or x["st"] < MIN_STARS:
            continue
        e = {"n": x["name"], "r": "https://github.com/" + x["name"], "d": "", "c": "", "a": [], "s": "gh"}
        items.append(finalize(e, x, cache.get(u, [None, []])[1]))
    return items


PARSERS = {"runa": parse_runa, "btw": parse_btw, "instead-of": parse_instead_of,
           "selfhosted": parse_selfhosted, "saas": parse_saas, "openalternative": parse_openalternative}


def main():
    curated = []
    for src, url in SOURCES.items():
        try:
            got = PARSERS[src](fetch(url))
        except Exception as e:  # one broken source must not kill the build
            print(f"skip {src}: {e}")
            continue
        print(f"{src}: {len(got)}")
        curated += got
    if not curated:
        raise SystemExit("no entries parsed, keeping old index")

    token = os.environ.get("GITHUB_TOKEN")
    old = load_json(OUT, [])
    cache = load_json(CACHE, {})
    if token:
        apps = load_json(OUT.parent / "apps.json", {})
        discovered = discover(token, apps)
        items = build(curated, discovered, token, cache)
    else:
        # No token: refresh the curated lists, keep everything GitHub-derived from the last build.
        print("GITHUB_TOKEN not set: keeping GitHub data from the previous index")
        prev = {(e.get("r") or "").lower(): e for e in old if e.get("r")}
        items = []
        for e in curated:
            p = prev.get((e.get("r") or "").lower())
            if p:
                e.update({k: p[k] for k in ("st", "up", "l", "li", "t", "k", "p") if k in p})
                e["a"] = list(dict.fromkeys(e["a"] + p.get("a", [])))
            items.append(finalize(e, None, p.get("p", []) if p else []))
        cur = {(e.get("r") or "").lower() for e in items}
        items += [e for e in old if e.get("s") == "gh" and e["r"].lower() not in cur]

    if len(items) < len(old) * 0.7:
        raise SystemExit(f"only {len(items)} entries vs {len(old)} before: refusing to shrink the index")
    OUT.write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")))
    CACHE.write_text(json.dumps(cache, separators=(",", ":")))
    print(f"wrote {len(items)} entries ({sum(1 for e in items if e['s'] == 'gh')} discovered, "
          f"{sum(1 for e in items if e.get('p'))} with platforms, {OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
