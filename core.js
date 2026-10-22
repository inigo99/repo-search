// Search core shared by the web page (index.html) and the CLI (cli.js).
// No dependencies. Works in browsers and Node 18+.
(function (root) {
  const GH_API = "https://api.github.com/search/repositories";

  const norm = (s) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9+#.\- ]+/g, " ").replace(/\s+/g, " ").trim();

  const hasWords = (hay, needle) => (" " + hay + " ").includes(" " + needle + " ");

  // Spanish (or mixed) query -> { terms, app, func, alt, english }
  function parseQuery(query, dict, apps) {
    const words = norm(query).split(" ").filter(Boolean);
    const out = [];
    let alt = false;
    for (let i = 0; i < words.length; ) {
      let hit = null;
      for (let n = Math.min(4, words.length - i); n > 0 && !hit; n--) {
        const key = words.slice(i, i + n).join(" ");
        if (key in dict) hit = { n, v: dict[key] };
      }
      if (!hit) {
        const w = words[i];
        // naive Spanish plural: "editores" -> "editor", "fotos" -> "foto"
        const stem = [w.replace(/es$/, ""), w.replace(/s$/, "")].find((s) => s !== w && s in dict);
        hit = { n: 1, v: stem ? dict[stem] : w };
      }
      if (hit.v === "@alt") alt = true;
      else if (hit.v) out.push(...hit.v.split(" "));
      i += hit.n;
    }
    // Known proprietary app? Longest key wins ("adobe acrobat" over "acrobat").
    const english = out.join(" ");
    let app = Object.keys(apps).filter((k) => !k.startsWith("_"))
      .sort((a, b) => b.length - a.length)
      .find((k) => hasWords(english, k)) || null;
    // App names are never translated, so their words survive in `out`.
    const appWords = app ? app.split(" ") : [];
    const filler = ["app", "tool", "software"];
    const rest = out.filter((w) => !appWords.includes(w) && !filler.includes(w));
    // "excel to csv converter" or "word plugin" is about the app, not a replacement:
    // only treat it as "alternative to <app>" if asked, or if the app is all that was typed.
    if (app && !alt && rest.length) app = null;
    const terms = [...new Set(app ? rest : out.filter((w) => !filler.includes(w)))];
    return { terms, app, func: app ? apps[app] : null, alt: alt || !!app, english };
  }

  const PLATFORMS = ["windows", "macos", "linux", "android", "ios"];

  // Normalised text of every entry, computed once per loaded index.
  // Fields are optional in index.json (empty ones are left out to keep it small).
  const prepared = new WeakMap();
  function prepare(index) {
    if (prepared.has(index)) return prepared.get(index);
    const dash = (s) => { const n = norm(s || ""); return n.includes("-") ? n + " " + n.replace(/-/g, " ") : n; };
    const rows = index.map((e) => ({
      name: dash(e.n), cat: norm(e.c || ""), desc: norm(e.d || ""),
      topics: dash((e.t || []).join(" ")), alts: (e.a || []).map(norm).filter(Boolean),
    }));
    const targets = new Set(rows.flatMap((r) => r.alts));
    const out = { rows, targets };
    prepared.set(index, out);
    return out;
  }

  // Popularity and freshness multiplier: relevance decides what matches,
  // this decides the order among good matches.
  const DAY = 864e5;
  function quality(e, now = Date.now()) {
    const stars = 1 + Math.log10((e.st || 0) + 1) / 2;          // 0★ 1, 100★ 2, 10k★ 3
    const age = e.up ? (now - Date.parse(e.up)) / DAY : null;
    const fresh = age == null ? 0.9 : age < 365 ? 1 : age < 730 ? 0.85 : 0.6;
    return stars * fresh * (e.k ? 0.35 : 1);                    // awesome-lists sink
  }

  // English synonyms: a query word also matches the other words of its group.
  const SYNONYMS = [
    ["editor", "editing"], ["photo", "image", "picture"], ["note", "note-taking", "notetaking", "notebook"],
    ["chat", "messaging", "messenger"], ["mail", "email", "e-mail"], ["todo", "to-do", "task"],
    ["drawing", "sketching", "painting", "paint"], ["diagram", "flowchart"], ["spreadsheet", "sheet"],
    ["presentation", "slides", "slideshow"], ["download", "downloader"], ["converter", "convert", "conversion"],
    ["recorder", "recording"], ["screenshot", "screen-capture", "screencapture"],
    ["self-hosted", "selfhosted", "self-hostable"], ["analytics", "statistics", "stats"],
    ["manager", "management"], ["reader", "viewer"], ["ebook", "e-book", "epub"], ["game", "gaming"],
    ["wiki", "knowledge-base"], ["bookmark", "bookmarking"], ["translate", "translation", "translator"],
    ["transcription", "speech-to-text", "stt"], ["music", "songs"], ["streaming", "stream"],
  ];
  const SYN = new Map(SYNONYMS.flatMap((g) => g.map((w) => [w, g])));
  const singular = (w) => w.length > 3 && w.endsWith("ies") ? w.slice(0, -3) + "y"
    : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
  // Every form of a query word that counts as a match.
  const variants = (w) => { const s = singular(w); return [...new Set([w, s, ...(SYN.get(w) || SYN.get(s) || [])])]; };

  // Filters shared by index entries and live GitHub results.
  // item: { lic: SPDX id, lang, up: ISO date }; f: { license: ""|"permissive"|"copyleft", language, active }
  const PERMISSIVE = /^(MIT|MIT-0|Apache-2\.0|BSD-[23]-Clause|0BSD|ISC|Unlicense|Zlib|BSL-1\.0|CC0-1\.0|WTFPL|PostgreSQL|Artistic-2\.0|NCSA|UPL-1\.0)$/i;
  const COPYLEFT = /^(A?GPL|LGPL|MPL|EPL|EUPL|CDDL|OSL|CECILL)/i;
  const ACTIVE_DAYS = 730;
  function passesFilters(item, f = {}, now = Date.now()) {
    if (f.license === "permissive" && !PERMISSIVE.test(item.lic || "")) return false;
    if (f.license === "copyleft" && !COPYLEFT.test(item.lic || "")) return false;
    if (f.language && (item.lang || "").toLowerCase() !== f.language.toLowerCase()) return false;
    if (f.active && !(item.up && now - Date.parse(item.up) < ACTIVE_DAYS * DAY)) return false;
    return true;
  }

  // Most common languages in the index, for the language filter.
  function topLanguages(index, n = 20) {
    const count = {};
    for (const e of index) if (e.l) count[e.l] = (count[e.l] || 0) + 1;
    return Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, n).sort((a, b) => a.localeCompare(b));
  }

  // Rank entries of data/index.json. `platforms`: keep entries known to run on at
  // least one of them (entries with unknown platforms are dropped). `filters`: see passesFilters.
  function searchIndex(p, index, limit = 30, platforms = [], filters = {}) {
    const { rows, targets } = prepare(index);
    const words = [...new Set([...p.terms, ...(p.func ? p.func.split(" ") : [])])].filter((w) => w.length > 1);
    const forms = words.map(variants);
    const need = Math.max(1, Math.ceil(words.length * 0.6));
    // "alternativa a Moodle", or just "Notion": any product some repo says it replaces.
    const typed = p.terms.join(" ");
    const target = p.app || (p.alt || targets.has(typed) ? typed : null);
    const now = Date.now();
    const scored = [];
    index.forEach((e, i) => {
      if (platforms.length && !(e.p || []).some((x) => platforms.includes(x))) return;
      if (!passesFilters({ lic: e.li, lang: e.l, up: e.up }, filters, now)) return;
      const r = rows[i];
      let score = 0, matched = 0;
      if (target && r.alts.some((x) => hasWords(x, target) || hasWords(target, x))) score += 10;
      for (const ws of forms) {
        const any = (field) => ws.some((w) => hasWords(field, w));
        const s = (any(r.name) ? 3 : 0) + (any(r.topics) ? 2 : 0) + (any(r.cat) ? 2 : 0) + (any(r.desc) ? 1 : 0);
        if (s) { score += s; matched++; }
      }
      if (score >= 10 || (matched >= need && score > 0)) scored.push({ ...e, score: score * quality(e) });
    });
    // Same project often appears in several lists: keep the best-scored one.
    const seen = new Set();
    return scored.sort((a, b) => b.score - a.score)
      .filter((e) => {
        const keys = [norm(e.n), (e.r || "").toLowerCase()].filter(Boolean);
        if (keys.some((k) => seen.has(k))) return false;
        keys.forEach((k) => seen.add(k));
        return true;
      })
      .slice(0, limit);
  }

  // GitHub queries to try, most specific first. GitHub ANDs every word,
  // so we fall back to shorter queries when a long one returns nothing.
  function githubQueries(p) {
    const q = [];
    if (p.app) {
      if (p.terms.length) q.push([...p.terms, p.func].join(" "));
      q.push(p.func, `${p.app} alternative`);
    } else {
      if (p.alt && p.terms.length) q.push(`${p.terms.join(" ")} alternative`);
      for (let n = p.terms.length; n > 0; n--) q.push(p.terms.slice(0, n).join(" "));
    }
    return [...new Set(q.filter(Boolean))];
  }

  // GitHub search has no platform filter and its OR operator is unreliable, so each
  // platform gets its own queries with the platform name as an extra keyword.
  // Each repo is tagged with the platforms whose query returned it (r.platforms).
  async function searchGithub(p, { token, perPage = 20, platforms = [], fetchFn = fetch } = {}) {
    const headers = { Accept: "application/vnd.github+json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const results = new Map();
    const used = [];
    for (const platform of platforms.length ? platforms : [""]) {
      let got = 0;
      for (const base of githubQueries(p)) {
        const q = `${base} ${platform}`.trim();
        const url = `${GH_API}?per_page=${perPage}&q=${encodeURIComponent(q + " fork:false stars:>5")}`;
        const res = await fetchFn(url, { headers });
        if (res.status === 403 || res.status === 429)
          throw new Error("GitHub rate limit reached. Wait a minute or add a token.");
        if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
        const items = (await res.json()).items || [];
        if (items.length) used.push(q);
        for (const r of items) {
          if (!results.has(r.full_name)) results.set(r.full_name, { ...r, platforms: [] });
          if (platform && !results.get(r.full_name).platforms.includes(platform))
            results.get(r.full_name).platforms.push(platform);
        }
        got += items.length;
        // Enough results: stop. Alternative searches always also try "<app> alternative".
        if (got >= perPage && !(p.app && base === p.func)) break;
      }
    }
    return { repos: [...results.values()], queries: used };
  }

  // mode: "match" (keep relevance order), "stars" or "updated". Works for curated
  // entries (st, up) and GitHub repos (stargazers_count, pushed_at).
  const SORT_KEYS = {
    stars: (x) => x.st ?? x.stargazers_count ?? -1,
    updated: (x) => x.up ?? x.pushed_at ?? "",
  };
  function sortItems(items, mode) {
    const k = SORT_KEYS[mode];
    if (!k) return items;
    return [...items].sort((a, b) => (k(a) < k(b) ? 1 : k(a) > k(b) ? -1 : 0));
  }

  // Saved repos: { [url]: { name, url, desc, stars, cats: [..], added } }.
  // A repo can be in several categories; an empty list means "Uncategorized".
  function savedCategories(saved) {
    const count = {};
    for (const s of Object.values(saved)) for (const c of s.cats) count[c] = (count[c] || 0) + 1;
    return Object.keys(count).sort((a, b) => a.localeCompare(b)).map((name) => ({ name, count: count[name] }));
  }
  function removeCategory(saved, cat, at = new Date().toISOString()) {
    const out = {};
    for (const [k, s] of Object.entries(saved))
      out[k] = s.cats.includes(cat) ? { ...s, cats: s.cats.filter((c) => c !== cat), at } : s;
    return out;
  }
  // Sync between devices: per repo, the most recent change wins, whether it was a save/edit
  // (item.at) or a removal (deleted[url] = time). Each side: { saved: {url: item}, deleted: {url: ISO} }.
  function syncMerge(a, b) {
    const out = { saved: {}, deleted: {} };
    const urls = new Set([a, b].flatMap((x) => [...Object.keys(x.saved || {}), ...Object.keys(x.deleted || {})]));
    for (const url of urls) {
      let best = null; // [time, item | null]
      for (const x of [a, b]) {
        const item = x.saved?.[url], del = x.deleted?.[url];
        if (item && (!best || (item.at || "") > best[0] || ((item.at || "") === best[0] && !best[1]))) best = [item.at || "", item];
        if (del && (!best || del > best[0])) best = [del, null];
      }
      if (best[1]) out.saved[url] = best[1];
      else out.deleted[url] = best[0];
    }
    return out;
  }
  // Import: union of repos and of their categories; existing data wins otherwise.
  function mergeSaved(mine, incoming) {
    const out = { ...mine };
    for (const [k, s] of Object.entries(incoming || {})) {
      if (!s || typeof s.url !== "string" || !Array.isArray(s.cats)) continue; // ignore junk
      const cats = s.cats.filter((c) => typeof c === "string" && c.trim()).map((c) => c.trim());
      out[k] = out[k] ? { ...out[k], cats: [...new Set([...out[k].cats, ...cats])] } : { ...s, cats };
    }
    return out;
  }

  const api = { norm, parseQuery, searchIndex, githubQueries, searchGithub, sortItems, PLATFORMS,
    passesFilters, topLanguages, variants,
    savedCategories, removeCategory, mergeSaved, syncMerge };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RepoSearch = api;
})(this);
