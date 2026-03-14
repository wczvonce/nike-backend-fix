/**
 * Run: node scripts/test-pipeline-logic.js
 * Verifies comparison/mapping/math logic without live scraping.
 */
import {
  mapSelectionForSwap,
  mapLineForSwap,
  sameLine,
  computeMetrics,
  compareRows,
  validateMarketCandidate
} from "../src/utils/pipeline-logic.js";

let failed = 0;

function eq(actual, expected, msg) {
  const pass = actual === expected || (typeof actual === "number" && typeof expected === "number" && Math.abs(actual - expected) < 1e-9);
  if (!pass) {
    failed++;
    console.error("FAIL:", msg, "| expected:", expected, "got:", actual);
  } else {
    console.log("OK:", msg);
  }
}

function ok(cond, msg) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

console.log("--- swap mapping ---");
eq(mapSelectionForSwap("1x", true), "x2", "double chance 1x swap");
eq(mapSelectionForSwap("x2", true), "1x", "double chance x2 swap");
eq(mapSelectionForSwap("12", true), "12", "double chance 12 unchanged");
eq(mapSelectionForSwap("home", true), "away", "home<->away swap");
eq(mapSelectionForSwap("away", true), "home", "away<->home swap");
eq(mapLineForSwap(-1.5, "asian_handicap_2way", true), 1.5, "asian line sign flips on swap");
eq(mapLineForSwap(2.5, "over_under_2way", true), 2.5, "ou line unchanged on swap");
ok(sameLine(2.5, 2.5), "sameLine exact");
ok(sameLine(2.5, 2.500001), "sameLine tolerance");
ok(!sameLine(2.5, 3.5), "sameLine mismatch");

console.log("--- metrics ---");
const m = computeMetrics(1.7, 1.2);
eq(m.diff, 0.5, "diff");
eq(m.percentDiff, 41.67, "percentDiff");
eq(m.probabilityEdgePp, 24.51, "probabilityEdgePp");

console.log("--- row sorting ---");
const sorted = [
  { probabilityEdgePp: 2.0, diff: 0.1, kickoffAt: "2026-01-01T10:00:00" },
  { probabilityEdgePp: 1.9, diff: 0.5, kickoffAt: "2026-01-01T09:00:00" }
].sort(compareRows);
eq(sorted[0].probabilityEdgePp, 2.0, "sort by probability edge desc");

console.log("--- market validation ---");
const validDc = validateMarketCandidate({
  marketType: "double_chance",
  period: "full_time",
  selection: "1x",
  mappedSelection: "1x",
  nikeOdd: 1.31,
  tipsportOdd: 1.29,
  line: null,
  sourceLine: null,
  sourceMarketName: "Dvojitá šanca",
  columnLabels: ["1X", "12", "X2"],
  extractedOddsArray: [1.29, 1.35, 1.83],
  sourceSelection: "1x"
});
ok(validDc.ok, "valid double chance row accepted");

const badDcLabels = validateMarketCandidate({
  marketType: "double_chance",
  period: "full_time",
  selection: "1x",
  mappedSelection: "1x",
  nikeOdd: 1.31,
  tipsportOdd: 1.29,
  line: null,
  sourceLine: null,
  sourceMarketName: "Dvojitá šanca",
  columnLabels: ["1", "X", "2"],
  extractedOddsArray: [1.84, 4.22, 4.02],
  sourceSelection: "1x"
});
eq(badDcLabels.ok, false, "reject 1X2 mislabeled as double chance");

const badLine = validateMarketCandidate({
  marketType: "asian_handicap_2way",
  period: "full_time",
  selection: "home",
  mappedSelection: "home",
  nikeOdd: 1.95,
  tipsportOdd: 1.9,
  line: -1.5,
  sourceLine: -2.5,
  sourceMarketName: "Ázijský handicap",
  columnLabels: ["Handicap", "1", "2"],
  extractedOddsArray: [1.9, 1.9],
  sourceSelection: "home"
});
eq(badLine.ok, false, "reject handicap line mismatch");

if (failed > 0) {
  console.error("\nTotal failures:", failed);
  process.exit(1);
}
console.log("\nAll checks passed.");

