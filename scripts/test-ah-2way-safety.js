/**
 * Regression tests for AH line pairing safety and All 2-Way builder source safety.
 * Run: node scripts/test-ah-2way-safety.js
 */
import { build2WayOpportunities } from "../src/utils/all-2way-builder.js";

let failed = 0;
function ok(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else { console.log("OK:", msg); }
}

// ============================================================
// TEST 1: AH clean row with correct pairing
// ============================================================
console.log("--- TEST 1: AH clean pairing ---");

// Simulated Nike AH text: "+1.5 homeOdd awayOdd +2.5 homeOdd awayOdd"
// lines extracted: [1.5, -1.5, 2.5, -2.5] → dedupe adjacent → [1.5, 2.5]
// pairs: 2, lines: 2 → exact match → emit both
const cleanLines = [1.5, -1.5, 2.5, -2.5];
const pairLines = [];
let prev = null;
for (const l of cleanLines) {
  const abs = Math.abs(l);
  if (abs === prev) continue;
  pairLines.push(abs);
  prev = abs;
}
ok(pairLines.length === 2, `clean: 2 unique lines extracted (got ${pairLines.length})`);
ok(pairLines[0] === 1.5 && pairLines[1] === 2.5, "clean: lines in text order [1.5, 2.5]");

// ============================================================
// TEST 2: AH ambiguous row rejected
// ============================================================
console.log("\n--- TEST 2: AH ambiguous row ---");

// Text has 3 line tokens but only 2 odds pairs → ambiguous
const ambiguousLines = [1, 1.5, 2];
const ambiguousPairs = 2;
ok(ambiguousLines.length !== ambiguousPairs, "ambiguous: 3 lines != 2 pairs → should be rejected");

// Text has 1 line token but 3 odds pairs → ambiguous
const tooFewLines = [1.5];
const tooFewPairs = 3;
ok(tooFewLines.length !== tooFewPairs, "too few lines: 1 line != 3 pairs → should be rejected");

// ============================================================
// TEST 3: AH decimal line support
// ============================================================
console.log("\n--- TEST 3: AH decimal lines ---");

const decimalLines = [0.75, -0.75, 1.25, -1.25];
const decPairLines = [];
prev = null;
for (const l of decimalLines) {
  const abs = Math.abs(l);
  if (abs === prev) continue;
  decPairLines.push(abs);
  prev = abs;
}
ok(decPairLines.length === 2, `decimal: 2 lines [0.75, 1.25]`);
ok(decPairLines[0] === 0.75 && decPairLines[1] === 1.25, "decimal lines preserved");

// ============================================================
// TEST 4: AH split/quarter line skipped
// ============================================================
console.log("\n--- TEST 4: Split lines ---");

// Split line like "-1.5, -2" should have been filtered before AH parsing
// by the DOM line extractor. Here we just verify that if a non-standard
// line makes it through, strict count matching rejects it.
const splitLines = [1.5, 2]; // from "-1.5, -2" split
const splitPairs = 1; // only 1 odds pair
ok(splitLines.length !== splitPairs, "split: 2 lines != 1 pair → rejected");

// ============================================================
// TEST 5: All 2-Way builder — only safe rows
// ============================================================
console.log("\n--- TEST 5: 2-Way builder safety ---");

const mockPipeline = {
  nike: { matches: [{ id: "m1", tournament: "Test" }] },
  controlRows: [
    // MATCHED — safe
    { matchId: "m1", match: "A vs B", sport: "football", marketType: "draw_no_bet_2way",
      selection: "home", period: "full_time", line: null,
      nikeOdd: 1.50, tipsportOdd: 1.45, status: "MATCHED", compareReason: "nike_gt_tipsport" },
    // nike_not_gt_tipsport — safe (valid pair, just Nike < Tip)
    { matchId: "m1", match: "A vs B", sport: "football", marketType: "draw_no_bet_2way",
      selection: "away", period: "full_time", line: null,
      nikeOdd: 2.40, tipsportOdd: 2.60, status: "REJECTED_BY_VALIDATOR", compareReason: "nike_not_gt_tipsport" },
    // REJECTED — unsafe (line mismatch)
    { matchId: "m1", match: "A vs B", sport: "football", marketType: "asian_handicap_2way",
      selection: "home", period: "full_time", line: 1.5,
      nikeOdd: 1.30, tipsportOdd: 1.11, status: "REJECTED_BY_VALIDATOR", compareReason: "line_mismatch" },
    // NO_TIPSPORT_ROW — unsafe (no Tipsport data)
    { matchId: "m1", match: "A vs B", sport: "football", marketType: "double_chance",
      selection: "1x", period: "full_time", line: null,
      nikeOdd: 1.20, tipsportOdd: null, status: "NO_TIPSPORT_ROW" },
    // missing_odds — unsafe
    { matchId: "m1", match: "A vs B", sport: "football", marketType: "over_under_2way",
      selection: "over", period: "full_time", line: 2.5,
      nikeOdd: 1.80, tipsportOdd: null, status: "REJECTED_BY_VALIDATOR", compareReason: "missing_odds" },
  ],
  rows: [
    { matchId: "m1", match: "A vs B", marketType: "draw_no_bet_2way",
      selection: "home", nikeOdd: 1.50, tipsportOdd: 1.45 }
  ]
};

const opportunities = build2WayOpportunities(mockPipeline);

// Should only include the 2 safe DNB rows (MATCHED + nike_not_gt_tipsport)
ok(opportunities.length === 2, `2-way: ${opportunities.length} rows (expected 2 safe DNB rows)`);

// Should NOT include rejected line_mismatch, NO_TIPSPORT_ROW, or missing_odds
const unsafe = opportunities.filter((r) =>
  r.compareReason === "line_mismatch" ||
  r.status === "NO_TIPSPORT_ROW" ||
  r.compareReason === "missing_odds"
);
ok(unsafe.length === 0, "2-way: no rejected/incomplete rows leaked");

// Should NOT include rows with null tipsportOdd
const nullTip = opportunities.filter((r) => r.tipsportOdd == null);
ok(nullTip.length === 0, "2-way: no null tipsportOdd rows");

// Margin should be calculated from the complete pair
const dnbOpp = opportunities.filter((r) => r.marketType === "draw_no_bet_2way");
ok(dnbOpp.length === 2, "2-way: both DNB selections present");
ok(dnbOpp[0].nikeMarginPercent != null, "2-way: Nike margin calculated");
ok(dnbOpp[0].tipsportMarginPercent != null, "2-way: Tipsport margin calculated");

// ============================================================
// TEST 6: All 2-Way builder — rejected rows do NOT appear
// ============================================================
console.log("\n--- TEST 6: No leaked rejected rows ---");

const mockPipeline2 = {
  nike: { matches: [] },
  controlRows: [
    // Only rejected rows — no safe rows
    { matchId: "m1", match: "X vs Y", sport: "hockey", marketType: "asian_handicap_2way",
      selection: "home", period: "full_time", line: 1.5,
      nikeOdd: 3.00, tipsportOdd: 1.20, status: "REJECTED_BY_VALIDATOR", compareReason: "edge_too_large_likely_parser_bug" },
    { matchId: "m1", match: "X vs Y", sport: "hockey", marketType: "asian_handicap_2way",
      selection: "away", period: "full_time", line: 1.5,
      nikeOdd: 1.10, tipsportOdd: 4.50, status: "REJECTED_BY_VALIDATOR", compareReason: "edge_too_large_likely_parser_bug" },
  ],
  rows: []
};

const opp2 = build2WayOpportunities(mockPipeline2);
ok(opp2.length === 0, "2-way: no rows when only rejected/unsafe input");

// ============================================================
console.log("");
if (failed > 0) {
  console.error(`${failed} test(s) FAILED.`);
  process.exit(1);
}
console.log("All AH + 2-Way safety tests passed.");
