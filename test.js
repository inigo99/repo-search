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
  console.log("all tests passed");
})();
