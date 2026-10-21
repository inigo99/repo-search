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

  // Rank curated entries from data/index.json. `platforms`: keep entries known
  // to run on at least one of them (entries with unknown platforms are dropped).
  function searchIndex(p, index, limit = 30, platforms = []) {
    if (platforms.length) index = index.filter((e) => (e.p || []).some((x) => platforms.includes(x)));
    const words = [...new Set([...p.terms, ...(p.func ? p.func.split(" ") : [])])].filter((w) => w.length > 1);
    const need = Math.max(1, Math.ceil(words.length * 0.6));
    // "alternativa a Moodle": Moodle is unknown to apps.json, but the lists may still know it.
    const target = p.app || (p.alt ? p.terms.join(" ") : null);
    const scored = [];
    for (const e of index) {
      let score = 0, matched = 0;
      if (target && e.a.some((a) => { const x = norm(a); return x && (hasWords(x, target) || hasWords(target, x)); }))
        score += 10;
      const name = norm(e.n), cat = norm(e.c), desc = norm(e.d);
      for (const w of words) {
        const s = (hasWords(name, w) ? 3 : 0) + (hasWords(cat, w) ? 2 : 0) + (hasWords(desc, w) ? 1 : 0);
        if (s) { score += s; matched++; }
      }
      if (score >= 10 || (matched >= need && score > 0)) scored.push({ ...e, score });
    }
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
  function removeCategory(saved, cat) {
    const out = {};
    for (const [k, s] of Object.entries(saved)) out[k] = { ...s, cats: s.cats.filter((c) => c !== cat) };
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
    savedCategories, removeCategory, mergeSaved };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RepoSearch = api;
})(this);
