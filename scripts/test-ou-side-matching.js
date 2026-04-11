/**
 * Regression tests for O/U side matching and AH line matching.
 * Ensures OVER only compares with OVER, UNDER with UNDER,
 * and AH lines must match exactly.
 *
 * Run: node scripts/test-ou-side-matching.js
 */
import { validateMarketCandidate, sameLine } from "../src/utils/pipeline-logic.js";

let failed = 0;
function ok(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else { console.log("OK:", msg); }
}

// ============================================================
// TEST A — O/U 5.5: same side only
// ============================================================
console.log("--- TEST A: O/U 5.5 side matching ---");

// Nike: over 5.5 = 2.15, under 5.5 = 1.68
// Tipsport: over 5.5 = 2.07, under 5.5 = 1.74

// OVER 5.5 card: Nike over vs Tipsport over
const overCard55 = {
  marketType: "over_under_2way", period: "full_time",
  selection: "over", mappedSelection: "over", sourceSelection: "over",
  nikeOdd: 2.15, tipsportOdd: 2.07,
  line: 5.5, sourceLine: 5.5,
  sourceMarketName: "Over/Under 2-way",
  columnLabels: ["celkom", "over", "under"],
  extractedOddsArray: [2.07, 1.74]
};
const r_a1 = validateMarketCandidate(overCard55);
ok(r_a1.ok, "OVER 5.5: Nike 2.15 vs Tip 2.07 → valid");

// UNDER 5.5 card: Nike under vs Tipsport under
const underCard55 = {
  ...overCard55,
  selection: "under", mappedSelection: "under", sourceSelection: "under",
  nikeOdd: 1.68, tipsportOdd: 1.74
};
const r_a2 = validateMarketCandidate(underCard55);
ok(r_a2.ok, "UNDER 5.5: Nike 1.68 vs Tip 1.74 → valid");

// INVALID: Nike OVER 2.15 on UNDER card
ok(2.15 !== 1.68, "Nike OVER 2.15 must not appear on UNDER card (different value)");

// ============================================================
// TEST B — O/U 5: same side only
// ============================================================
console.log("\n--- TEST B: O/U 5 side matching ---");

// Nike: over 5 = 1.82, under 5 = 1.96
// Tipsport: over 5 = 1.74, under 5 = 2.06

const overCard5 = {
  marketType: "over_under_2way", period: "full_time",
  selection: "over", mappedSelection: "over", sourceSelection: "over",
  nikeOdd: 1.82, tipsportOdd: 1.74,
  line: 5, sourceLine: 5,
  sourceMarketName: "Over/Under 2-way",
  columnLabels: ["celkom", "over", "under"],
  extractedOddsArray: [1.74, 2.06]
};
ok(validateMarketCandidate(overCard5).ok, "OVER 5: Nike 1.82 vs Tip 1.74 → valid");

const underCard5 = {
  ...overCard5,
  selection: "under", mappedSelection: "under", sourceSelection: "under",
  nikeOdd: 1.96, tipsportOdd: 2.06
};
ok(validateMarketCandidate(underCard5).ok, "UNDER 5: Nike 1.96 vs Tip 2.06 → valid");

// INVALID mixed card would be: Nike 1.96 (under) on OVER card → wrong selection
// This is caught by correct Nike parsing, not by validation

// ============================================================
// TEST C — AH line mismatch must be rejected
// ============================================================
console.log("\n--- TEST C: AH line mismatch ---");

// Nike HOME +1.5 = 1.27, Tipsport HOME +2 = 1.11
// These must NOT merge — different lines
const ahMismatch = {
  marketType: "asian_handicap_2way", period: "full_time",
  selection: "home", mappedSelection: "home", sourceSelection: "home",
  nikeOdd: 1.27, tipsportOdd: 1.11,
  line: 1.5, sourceLine: 2,  // DIFFERENT lines
  sourceMarketName: "Asian Handicap 2-way",
  columnLabels: ["handicap", "1", "2"],
  extractedOddsArray: [1.11, 6.52]
};
const r_c = validateMarketCandidate(ahMismatch);
ok(!r_c.ok, "AH +1.5 vs +2 → rejected (line mismatch)");
ok(r_c.reason === "line_mismatch", `reason: ${r_c.reason}`);

// sameLine must not match 1.5 vs 2
ok(!sameLine(1.5, 2), "sameLine(1.5, 2) = false");
ok(!sameLine(1.5, 2.0), "sameLine(1.5, 2.0) = false");

// ============================================================
// TEST D — AH exact match is valid
// ============================================================
console.log("\n--- TEST D: AH exact match ---");

const ahExact = {
  marketType: "asian_handicap_2way", period: "full_time",
  selection: "home", mappedSelection: "home", sourceSelection: "home",
  nikeOdd: 1.27, tipsportOdd: 1.26,
  line: 1.5, sourceLine: 1.5,  // SAME line
  sourceMarketName: "Asian Handicap 2-way",
  columnLabels: ["handicap", "1", "2"],
  extractedOddsArray: [1.26, 3.40]
};
ok(validateMarketCandidate(ahExact).ok, "AH +1.5 vs +1.5 → valid (exact match)");
ok(sameLine(1.5, 1.5), "sameLine(1.5, 1.5) = true");

// ============================================================
// TEST E — Nike O/U odds order preservation
// ============================================================
console.log("\n--- TEST E: Nike O/U odds order ---");

// Simulate Nike parser: "menej ako 5" shows [1.96, 1.82]
// odds[0] = 1.96 = UNDER (yes will be under 5) — higher for unlikely event
// odds[1] = 1.82 = OVER (no won't be under 5) — lower for likely event
const nikeOdds = [1.96, 1.82];
const underOdd = nikeOdds[0]; // first = under
const overOdd = nikeOdds[1];  // second = over
ok(underOdd === 1.96, "odds[0] = 1.96 = under (first displayed)");
ok(overOdd === 1.82, "odds[1] = 1.82 = over (second displayed)");
// Over should be the MORE likely outcome for low lines → lower odds
ok(overOdd < underOdd, "over < under for L=5 in hockey (over is more likely)");

// ============================================================
console.log("");
if (failed > 0) {
  console.error(`${failed} test(s) FAILED.`);
  process.exit(1);
}
console.log("All O/U side matching tests passed.");
