import process from "node:process";

const base = process.env.VERIFY_BASE_URL || "http://localhost:3001";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

const full = await fetch(`${base}/api/debug/full-check`).then((r) => r.json());
if (!full?.ok) fail(`full-check failed: ${JSON.stringify(full)}`);
const matrix = Array.isArray(full.supportMatrix) ? full.supportMatrix : [];

const contradictions = matrix.filter((m) => m.compareWired && (!m.nikeEmits || !m.flashscoreParses || !m.tested));
if (contradictions.length) {
  fail(`QA contradiction: compareWired market missing evidence: ${contradictions.map((x) => x.marketType).join(", ")}`);
}

if (full.checks?.nikeValidation?.ok === false) {
  fail("QA critical: nikeValidation is false");
}
if (full.checks?.finalComparisonValidation?.ok === false) {
  fail("QA critical: finalComparisonValidation is false");
}
if (full.checks?.allFinalRowsNikeGtTipsport === false) {
  fail("QA critical: final rows include nikeOdd <= tipsportOdd");
}
if (full.status === "PASS" && full.checks?.marketValidation?.ok === false) {
  fail("QA contradiction: PASS status while marketValidation is false");
}

console.log(`OK: QA consistency checks passed (status=${full.status})`);

