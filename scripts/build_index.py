#!/usr/bin/env python3
"""Build data/index.json from curated open-source alternative lists.

Usage: python scripts/build_index.py
Stdlib only. Run weekly by .github/workflows/update-index.yml.
"""
import json
import re
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
OUT = Path(__file__).resolve().parent.parent / "data" / "index.json"


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


PARSERS = {"runa": parse_runa, "btw": parse_btw, "instead-of": parse_instead_of,
           "selfhosted": parse_selfhosted, "saas": parse_saas, "openalternative": parse_openalternative}


def main():
    items = []
    for src, url in SOURCES.items():
        try:
            got = PARSERS[src](fetch(url))
        except Exception as e:  # one broken source must not kill the build
            print(f"skip {src}: {e}")
            continue
        print(f"{src}: {len(got)}")
        items += got
    if not items:
        raise SystemExit("no entries parsed, keeping old index")
    OUT.write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {len(items)} entries to {OUT}")


if __name__ == "__main__":
    main()
