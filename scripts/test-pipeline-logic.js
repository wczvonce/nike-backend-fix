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
  validateMarketCandidate,
  isNikeGreaterThanTipsport
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

const badOuLine = validateMarketCandidate({
  marketType: "over_under_2way",
  period: "full_time",
  selection: "over",
  mappedSelection: "over",
  nikeOdd: 1.9,
  tipsportOdd: 1.88,
  line: 2.5,
  sourceLine: 3.5,
  sourceMarketName: "Over/Under",
  columnLabels: ["Celkom", "Over", "Under"],
  extractedOddsArray: [1.88, 1.91],
  sourceSelection: "over"
});
eq(badOuLine.ok, false, "reject over 2.5 vs over 3.5 mismatch");

const badPeriod = validateMarketCandidate({
  marketType: "draw_no_bet_2way",
  period: "first_half",
  selection: "home",
  mappedSelection: "home",
  nikeOdd: 1.95,
  tipsportOdd: 1.9,
  line: null,
  sourceLine: null,
  sourceMarketName: "Stávka bez remízy",
  columnLabels: ["1", "2"],
  extractedOddsArray: [1.9, 1.95],
  sourceSelection: "home"
});
eq(badPeriod.ok, false, "reject wrong period");

const badYesNoSide = validateMarketCandidate({
  marketType: "both_teams_to_score",
  period: "full_time",
  selection: "yes",
  mappedSelection: "yes",
  nikeOdd: 1.8,
  tipsportOdd: 1.7,
  line: null,
  sourceLine: null,
  sourceMarketName: "Obaja dajú gól",
  columnLabels: ["Yes", "No"],
  extractedOddsArray: [1.7, 2.1],
  sourceSelection: "no"
});
eq(badYesNoSide.ok, false, "reject wrong yes/no side mapping");

eq(isNikeGreaterThanTipsport(1.8, 1.7), true, "nike > tipsport filter allows row");
eq(isNikeGreaterThanTipsport(1.7, 1.7), false, "nike == tipsport excluded");
eq(isNikeGreaterThanTipsport(1.6, 1.7), false, "nike < tipsport excluded");

if (failed > 0) {
  console.error("\nTotal failures:", failed);
  process.exit(1);
}
console.log("\nAll checks passed.");

