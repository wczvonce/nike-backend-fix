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
if (Number(fsSession.networkFirstHits || 0) <= 0) {
  fail("network-first path not used (networkFirstHits <= 0)");
}

const full = await fetch(`${base}/api/debug/full-check`).then((r) => r.json());
if (!full?.ok) fail(`full-check failed: ${JSON.stringify(full)}`);
const rowsBySource = full?.sourceCoverage?.finalRowsBySource || {};
if (!Object.keys(rowsBySource).length) {
  fail("missing sourceCoverage.finalRowsBySource");
}
if (!rowsBySource.network_direct_html && !rowsBySource.dom_fallback) {
  fail("source coverage does not report network/direct or dom fallback sources");
}

console.log(`OK: flashscore network verification passed (browserLaunches=${fsSession.browserLaunches}, networkFirstHits=${fsSession.networkFirstHits}, domFallbackHits=${fsSession.domFallbackHits})`);
