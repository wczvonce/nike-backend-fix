import process from "node:process";

const base = process.env.VERIFY_BASE_URL || "http://localhost:3001";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

const full = await fetch(`${base}/api/debug/full-check`).then((r) => r.json());
if (!full?.ok) fail(`full-check endpoint failed: ${JSON.stringify(full)}`);
const matrix = Array.isArray(full.supportMatrix) ? full.supportMatrix : [];
if (!matrix.length) fail("supportMatrix is empty");

for (const item of matrix) {
  if (item.compareWired) {
    if (!item.nikeEmits) fail(`${item.marketType}: compare wired but Nike does not emit`);
    if (!item.flashscoreParses) fail(`${item.marketType}: compare wired but Flashscore parse evidence missing`);
    if (!item.tested) fail(`${item.marketType}: compare wired but tested=false`);
  }
}

console.log("OK: support matrix consistency checks passed");

