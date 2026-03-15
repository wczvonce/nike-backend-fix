import process from "node:process";
import { compareRows, round2 } from "../src/utils/pipeline-logic.js";

const base = process.env.VERIFY_BASE_URL || "http://localhost:3001";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

const response = await fetch(`${base}/api/pipeline/nike-vs-tipsport`).then((r) => r.json());
if (!response?.ok) fail(`pipeline endpoint failed: ${JSON.stringify(response)}`);
const rows = Array.isArray(response.rows) ? response.rows : [];

for (const row of rows) {
  if (!(row.nikeOdd > row.tipsportOdd)) fail(`nikeOdd <= tipsportOdd for ${row.match} ${row.marketType} ${row.selection}`);
  if (!String(row?.normalizedTipsportMarket?.bookmaker || "").toLowerCase().includes("tipsport")) {
    fail(`non-Tipsport bookmaker in final row: ${row.match} ${row.marketType}`);
  }
  const diff = round2(row.nikeOdd - row.tipsportOdd);
  const percentDiff = round2(((row.nikeOdd - row.tipsportOdd) / row.tipsportOdd) * 100);
  const edge = round2(((1 / row.tipsportOdd) - (1 / row.nikeOdd)) * 100);
  if (row.diff !== diff || row.percentDiff !== percentDiff || row.probabilityEdgePp !== edge) {
    fail(`metrics mismatch for ${row.match} ${row.marketType} ${row.selection}`);
  }
  if (!row.sourceType) fail(`missing sourceType for ${row.match} ${row.marketType} ${row.selection}`);
  if (!Array.isArray(row.attemptedSources)) fail(`missing attemptedSources for ${row.match} ${row.marketType} ${row.selection}`);
  if (row.swapped == null) fail(`missing swapped flag for ${row.match} ${row.marketType} ${row.selection}`);
  if (!row.selectionConfidence) fail(`missing selectionConfidence for ${row.match} ${row.marketType} ${row.selection}`);
}

const sorted = [...rows].sort(compareRows);
if (JSON.stringify(sorted) !== JSON.stringify(rows)) {
  fail("final rows are not sorted by probability edge, diff, date");
}

console.log(`OK: final output checks passed (${rows.length} rows)`);

