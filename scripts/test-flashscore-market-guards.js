/**
 * Run: node scripts/test-flashscore-market-guards.js
 * Deterministic guards for label safety checks (no live scraping).
 */
import {
  isExactOrderedLabelSet,
  isSafeDoubleChanceLabels,
  isSafeMatchWinner2WayLabels
} from "../src/scrapers/flashscore.js";

let failed = 0;

function eq(actual, expected, msg) {
  if (actual !== expected) {
    failed++;
    console.error("FAIL:", msg, "| expected:", expected, "got:", actual);
  } else {
    console.log("OK:", msg);
  }
}

console.log("--- label guards ---");
eq(isExactOrderedLabelSet(["1X", "12", "X2"], ["1x", "12", "x2"]), true, "ordered exact set check works");
eq(isSafeDoubleChanceLabels(["1X", "12", "X2"]), true, "double chance exact labels accepted");
eq(isSafeDoubleChanceLabels(["1", "X", "2"]), false, "double chance rejects 1X2 labels");
eq(isSafeMatchWinner2WayLabels(["1", "2"]), true, "winner 2-way accepts 1/2");
eq(isSafeMatchWinner2WayLabels(["1", "X", "2"]), false, "winner 2-way rejects 1X2");
eq(isSafeMatchWinner2WayLabels(["home", "away"]), false, "winner 2-way rejects unresolved home/away labels");

if (failed > 0) {
  console.error("\nTotal failures:", failed);
  process.exit(1);
}
console.log("\nAll checks passed.");

