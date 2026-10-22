// Run: node test.js   (no network needed)
const assert = require("assert");
const core = require("./core.js");
const dict = require("./data/es-en.json");
const apps = require("./data/apps.json");
const index = require("./data/index.json");
const P = (q) => core.parseQuery(q, dict, apps);

// Spanish -> English, accents and plurals
assert.deepStrictEqual(P("Editor de vídeo ligero").terms, ["editor", "video", "lightweight"]);
assert.deepStrictEqual(P("programa para unir PDFs").terms, ["merge", "pdf"]);
assert.deepStrictEqual(P("gestor de contraseñas autoalojado").terms, ["manager", "password", "self-hosted"]);

// Known app alone or with "alternativa" => alternative search
for (const q of ["Adobe Acrobat", "alternativa gratuita a Adobe Acrobat", "alternative to adobe acrobat"]) {
  const p = P(q);
  assert.strictEqual(p.app, "adobe acrobat", q);
  assert.strictEqual(p.func, "pdf editor", q);
}
// App used as context, not as something to replace
assert.strictEqual(P("plugin de word para firmar documentos").app, null);
assert.deepStrictEqual(P("plugin de word para firmar documentos").terms, ["plugin", "word", "sign", "documents"]);

// Unknown app with "alternativa" still searches the curated lists' "alternative to" field
const moodle = P("alternativa a Notion");
assert.ok(core.searchIndex(moodle, index).some((e) => e.n === "AppFlowy"));
assert.ok(core.searchIndex(P("alternativa a Plex"), index).some((e) => e.n === "Jellyfin"));
assert.ok(core.searchIndex(P("gestor de contraseñas"), index).length > 0);

// GitHub fallback order
assert.deepStrictEqual(core.githubQueries(P("Adobe Acrobat")), ["pdf editor", "adobe acrobat alternative"]);
assert.deepStrictEqual(core.githubQueries(P("unir pdf")), ["merge pdf", "merge"]);

// searchGithub: falls back when empty, dedupes, reports rate limit
(async () => {
  const fake = (pages) => async (url) => ({
    ok: true, status: 200,
    json: async () => ({ items: pages[decodeURIComponent(url).split("q=")[1].replace(" fork:false stars:>5", "")] || [] }),
  });
  const r = await core.searchGithub(P("unir pdf"), { fetchFn: fake({ merge: [{ full_name: "a/b" }] }) });
  assert.deepStrictEqual(r.queries, ["merge"]);
  assert.strictEqual(r.repos.length, 1);
  const alt = await core.searchGithub(P("acrobat"), {
    fetchFn: fake({ "pdf editor": [{ full_name: "x/y" }], "acrobat alternative": [{ full_name: "x/y" }, { full_name: "z/w" }] }),
  });
  assert.strictEqual(alt.repos.length, 2);
  await assert.rejects(core.searchGithub(P("pdf"), { fetchFn: async () => ({ ok: false, status: 403 }) }), /rate limit/);

  // Platforms: one query per platform, repos tagged with every platform that found them
  const plat = await core.searchGithub(P("unir pdf"), {
    platforms: ["windows", "linux"],
    fetchFn: fake({ "merge pdf windows": [{ full_name: "a/b" }], "merge pdf linux": [{ full_name: "a/b" }, { full_name: "c/d" }] }),
  });
  assert.deepStrictEqual(plat.queries, ["merge pdf windows", "merge pdf linux"]);
  assert.deepStrictEqual(plat.repos.map((r) => [r.full_name, r.platforms]), [["a/b", ["windows", "linux"]], ["c/d", ["linux"]]]);
  console.log("async tests passed");
})();

// Curated platform filter drops entries with unknown or other platforms
const mini = [
  { n: "Win PDF", d: "pdf editor", c: "", a: [], p: ["windows"] },
  { n: "Droid PDF", d: "pdf editor", c: "", a: [], p: ["android"] },
  { n: "Any PDF", d: "pdf editor", c: "", a: [] },
];
const names = (pl) => core.searchIndex(P("editor pdf"), mini, 10, pl).map((e) => e.n).sort();
assert.deepStrictEqual(names([]), ["Any PDF", "Droid PDF", "Win PDF"]);
assert.deepStrictEqual(names(["windows", "linux"]), ["Win PDF"]);

// Ranking: entries without optional fields work; a product some repo replaces is an
// alternatives search even without "alternativa"; popular and fresh beats obscure and stale;
// awesome-lists sink below real projects.
const now = new Date().toISOString().slice(0, 10);
const idx = [
  { n: "notion-sdk", d: "Notion API client", s: "gh", st: 50000, up: now },
  { n: "acme/stale", d: "notes app", a: ["notion"], s: "gh", st: 5000, up: "2019-01-01" },
  { n: "acme/notes", d: "notes app", a: ["notion"], s: "gh", st: 5000, up: now },
  { n: "acme/tiny", d: "notes app", a: ["notion"], s: "gh", st: 3, up: now },
  { n: "awesome-notion-alternatives", d: "list", a: ["notion"], s: "gh", st: 90000, up: now, k: 1 },
  { n: "Bare" },
];
const ranked = core.searchIndex(P("Notion"), idx, 10).map((e) => e.n);
assert.deepStrictEqual(ranked.slice(0, 3), ["acme/notes", "acme/stale", "acme/tiny"], ranked.join());
assert.ok(ranked.indexOf("awesome-notion-alternatives") > 2 && !ranked.includes("notion-sdk"), ranked.join()); // SDKs are not alternatives
assert.deepStrictEqual(core.searchIndex(P("alternativa a Notion"), idx, 10).map((e) => e.n)[0], "acme/notes");
// Hyphenated names and topics match single words
assert.ok(core.searchIndex(P("pdf"), [{ n: "acme/pdf-tools", s: "gh" }, { n: "x", t: ["pdf-editor"], s: "gh" }], 5).length === 2);

// Sorting works on curated (st/up) and GitHub (stargazers_count/pushed_at) shapes; missing values last
assert.deepStrictEqual(core.sortItems([{ st: 5 }, {}, { st: 50 }], "stars"), [{ st: 50 }, { st: 5 }, {}]);
assert.deepStrictEqual(core.sortItems([{ pushed_at: "2024-01-01" }, { pushed_at: "2026-01-01" }], "updated").map((r) => r.pushed_at), ["2026-01-01", "2024-01-01"]);
assert.deepStrictEqual(core.sortItems([{ st: 1 }, { st: 9 }], "match"), [{ st: 1 }, { st: 9 }]);
// Saved repos: categories, delete category, import merge
const saved = {
  "https://github.com/a/b": { name: "a/b", url: "https://github.com/a/b", cats: ["PDF", "Work"] },
  "https://github.com/c/d": { name: "c/d", url: "https://github.com/c/d", cats: ["PDF"] },
};
assert.deepStrictEqual(core.savedCategories(saved), [{ name: "PDF", count: 2 }, { name: "Work", count: 1 }]);
assert.deepStrictEqual(core.removeCategory(saved, "PDF")["https://github.com/c/d"].cats, []);
assert.strictEqual(saved["https://github.com/c/d"].cats.length, 1, "removeCategory must not mutate");
const merged = core.mergeSaved(saved, {
  "https://github.com/a/b": { name: "a/b", url: "https://github.com/a/b", cats: ["Work", " Tools "] },
  "https://github.com/e/f": { name: "e/f", url: "https://github.com/e/f", cats: [] },
  junk: { url: 5 },
});
assert.deepStrictEqual(merged["https://github.com/a/b"].cats, ["PDF", "Work", "Tools"]);
assert.ok(merged["https://github.com/e/f"] && !merged.junk);

console.log("sync tests passed");
