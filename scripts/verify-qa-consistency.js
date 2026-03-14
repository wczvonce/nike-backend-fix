import process from "node:process";

const base = process.env.VERIFY_BASE_URL || "http://localhost:3001";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

const full = await fetch(`${base}/api/debug/full-check`).then((r) => r.json());
if (!full?.ok) fail(`full-check failed: ${JSON.stringify(full)}`);
if (full.status !== "PASS") fail(`full-check status is not PASS (${full.status})`);
const matrix = Array.isArray(full.supportMatrix) ? full.supportMatrix : [];

const contradictions = matrix.filter((m) => m.compareWired && (!m.nikeEmits || !m.flashscoreParses || !m.tested));
if (contradictions.length) {
  fail(`QA contradiction: compareWired market missing evidence: ${contradictions.map((x) => x.marketType).join(", ")}`);
}

if (full.status === "PASS" && full.checks?.marketValidation?.ok === false) {
  fail("QA contradiction: PASS status while marketValidation is false");
}

console.log("OK: QA consistency checks passed");

