import process from "node:process";

const base = process.env.VERIFY_BASE_URL || "http://localhost:3001";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

const pipeline = await fetch(`${base}/api/pipeline/nike-vs-tipsport`).then((r) => r.json());
if (!pipeline?.ok) fail(`pipeline failed: ${JSON.stringify(pipeline)}`);

const runtime = pipeline.runtime || {};
const fsSession = runtime.flashscoreSession || {};
if (Number(fsSession.browserLaunches || 0) !== 1) {
  fail(`expected one browser launch per run, got ${fsSession.browserLaunches}`);
}
if (fsSession.networkFirstEnabled !== true) {
  fail("network-first is not enabled");
}
if (fsSession.domFallbackEnabled !== true) {
  fail("dom fallback is not enabled (safe default required)");
}
if (Number(fsSession.networkFirstAttempts || 0) <= 0) {
  fail("network-first was not attempted");
}

const rows = Array.isArray(pipeline.rows) ? pipeline.rows : [];
if (!rows.length) fail("pipeline rows are empty");
for (const row of rows) {
  if (!row.sourceType) fail(`row missing sourceType (${row.match} ${row.marketType})`);
  if (!Array.isArray(row.attemptedSources)) fail(`row missing attemptedSources (${row.match} ${row.marketType})`);
}

const domRows = rows.filter((r) => r.sourceType === "dom_fallback");
for (const row of domRows) {
  if (!row.fallbackReason) fail(`dom fallback row missing fallbackReason (${row.match} ${row.marketType})`);
  const firstAttemptSource = row.attemptedSources?.[0]?.source || "";
  if (!String(firstAttemptSource).startsWith("network_")) {
    fail(`dom fallback row was not network-attempted first (${row.match} ${row.marketType})`);
  }
}

const full = await fetch(`${base}/api/debug/full-check`).then((r) => r.json());
if (!full?.ok) fail(`full-check failed: ${JSON.stringify(full)}`);
const rowsBySource = full?.sourceCoverage?.finalRowsBySource || {};
if (!Object.keys(rowsBySource).length) {
  fail("missing sourceCoverage.finalRowsBySource");
}
if (!rowsBySource.network_graphql && !rowsBySource.network_direct_html) {
  fail("source coverage does not report network-derived rows");
}

// Verify selectionConfidence is present for home/away market rows.
const homeAwayFamilies = new Set(["match_winner_2way", "draw_no_bet_2way", "asian_handicap_2way", "european_handicap_2way"]);
for (const row of rows) {
  if (homeAwayFamilies.has(row.marketType)) {
    if (!row.selectionConfidence) fail(`home/away row missing selectionConfidence (${row.match} ${row.marketType} ${row.selection})`);
    if (!row.attemptedSources?.length) fail(`home/away row missing attemptedSources (${row.match} ${row.marketType})`);
    if (row.swapped == null) fail(`home/away row missing swapped flag (${row.match} ${row.marketType})`);
  }
}
console.log(`OK: flashscore source verification passed (browserLaunches=${fsSession.browserLaunches}, networkFirstAttempts=${fsSession.networkFirstAttempts}, networkFirstHits=${fsSession.networkFirstHits}, domFallbackHits=${fsSession.domFallbackHits})`);
