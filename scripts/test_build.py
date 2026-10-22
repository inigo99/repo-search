"""Offline checks for build_index.py. Run: python3 scripts/test_build.py"""
import build_index as b

b.time.sleep = lambda s: None


def rest_item(name, stars, desc, topics=(), pushed="2026-10-01T00:00:00Z", archived=False):
    return {"full_name": name, "html_url": f"https://github.com/{name}", "stargazers_count": stars,
            "description": desc, "topics": list(topics), "pushed_at": pushed, "archived": archived,
            "language": "Go", "license": {"spdx_id": "MIT"}}


def gql_repo(name, stars, assets, desc="", topics=(), archived=False):
    return {"nameWithOwner": name, "stargazerCount": stars, "pushedAt": "2026-09-01T00:00:00Z",
            "isArchived": archived, "description": desc, "primaryLanguage": {"name": "Rust"},
            "licenseInfo": {"spdxId": "NOASSERTION"},
            "repositoryTopics": {"nodes": [{"topic": {"name": t}} for t in topics]},
            "releases": {"nodes": [{"releaseAssets": {"nodes": [{"name": a} for a in assets]}}] if assets else []}}


# --- alternative extraction ---
x = b.extract_alternatives
assert x("An open-source, self-hostable PaaS alternative to Vercel, Heroku & Netlify that lets you deploy") == ["vercel", "heroku", "netlify"]
assert x("Open source alternative to Auth0 / Firebase Auth / AWS Cognito") == ["auth0", "firebase auth", "aws cognito"]
assert x("Day.js 2kB library alternative to Moment.js with the same API") == ["moment.js"]
assert x("Scalable server. Self-hosted alternative to Pubnub, Pusher, socket.io, Phoenix.") == ["pubnub", "pusher", "socket.io", "phoenix"]
assert x("The open alternative to Salesforce, designed for AI.") == ["salesforce"]
assert x("A simple, fast and user-friendly alternative to 'find'") == ["find"]
assert x("A reverse proxy. An alternative to frp and ngrok.") == ["frp", "ngrok"]
assert x("Self-hosted Notion alternative") == ["notion"]
assert x("Open Source Alternative to Vercel.") == ["vercel"]
assert x("A note app", ["evernote-alternative", "open-source-alternative"]) == ["evernote"]
assert x("A collection of modern alternatives to common unix commands.") == []

# --- full build with mocked GitHub ---
calls = {"rest": [], "gql": []}
SEARCH = {
    "topic:self-hosted": [
        rest_item("acme/notes", 900, "Self-hosted alternative to Evernote", ["self-hosted", "android"]),
        rest_item("acme/dead", 500, "old", archived=True),
        rest_item("acme/curated", 300, "Curated one, from search"),
        rest_item("acme/awesome-things", 5000, "A list", ["awesome-list"]),
    ],
}


def fake_http(url, token, body=None, tries=4):
    if body is None:
        calls["rest"].append(url)
        q = b.urllib.parse.unquote(url.split("q=", 1)[1])
        return {"items": SEARCH.get(q.split(" ")[0], []) if "stars:>=2000" in q else []}
    calls["gql"].append(body["query"])
    data = {"rateLimit": {"remaining": 4000}}
    for line in body["query"].splitlines():
        if ": repository(" in line:
            alias, rest = line.split(": repository(")
            name = rest.split('"')[1] + "/" + rest.split('"')[3]
            data[alias.strip()] = {
                "acme/notes": gql_repo("acme/notes", 900, ["Notes-1.0.apk", "Notes-setup.exe"], "Self-hosted alternative to Evernote", ["self-hosted"]),
                "acme/curated": gql_repo("acme/curated", 300, ["curated.dmg"]),
                "acme/onlylisted": gql_repo("acme/onlylisted", 42, [], "Listed only", ["linux"]),
                "acme/awesome-things": gql_repo("acme/awesome-things", 5000, []),
            }.get(name)
    return {"data": data}


b.http_json = fake_http
curated = [
    {"n": "Curated", "u": "https://curated.example", "r": "https://github.com/acme/curated", "d": "", "c": "Notes", "a": ["OneNote"], "s": "runa"},
    {"n": "OnlyListed", "u": "https://github.com/acme/onlylisted", "r": "https://github.com/acme/onlylisted", "d": "", "c": "", "a": [], "s": "btw"},
    {"n": "NoRepo", "u": "https://norepo.example", "r": None, "d": "Mac app", "c": "", "a": [], "s": "openalternative"},
]
discovered = b.discover("T", {"notion": "notes"})
assert set(discovered) == {"https://github.com/acme/notes", "https://github.com/acme/curated",
                           "https://github.com/acme/awesome-things"}, discovered.keys()
assert any("%22notion%22%20alternative" in u for u in calls["rest"])

cache = {"https://github.com/gone/repo": ["2020-01-01", []]}
items = {e["n"]: e for e in b.build([dict(e) for e in curated], discovered, "T", cache)}

notes = items["acme/notes"]
assert notes["s"] == "gh" and notes["st"] == 900 and notes["a"] == ["evernote"], notes
assert notes["p"] == ["windows", "android"], notes  # release assets + topic
assert "acme/dead" not in items
cur = items["Curated"]
assert cur["st"] == 300 and cur["p"] == ["macos"] and cur["u"] == "https://curated.example" and cur["a"] == ["OneNote"], cur
only = items["OnlyListed"]
assert only["st"] == 42 and only["p"] == ["linux"] and only["d"] == "Listed only" and "u" not in only, only
assert items["NoRepo"]["p"] == ["macos"] and "st" not in items["NoRepo"]
assert items["acme/awesome-things"]["k"] == 1
assert "https://github.com/gone/repo" not in cache and cache["https://github.com/acme/notes"][1] == ["windows", "android"]

# Second run: unchanged repos are not re-read through GraphQL (cache hit by push date).
calls["gql"].clear()
for it in discovered.values():
    it["pushed_at"] = cache[it["html_url"].lower()][0] + "T00:00:00Z"
b.build([dict(e) for e in curated], discovered, "T", cache)
asked = "\n".join(calls["gql"])
assert '"notes"' not in asked and '"onlylisted"' in asked, asked  # curated-only repos always refreshed

print("build tests passed")
