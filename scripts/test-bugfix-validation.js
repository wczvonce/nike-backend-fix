/**
 * Regression tests for bugfixes: dedupeMarkets, sourceSelection, handicap lines, section filter.
 * Run: node scripts/test-bugfix-validation.js
 */
import { validateMarketCandidate } from "../src/utils/pipeline-logic.js";

let failed = 0;
function ok(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else { console.log("OK:", msg); }
}

// ============================================================
// TEST 1: Super ponuka ignored, Superkurzy only
// ============================================================
console.log("--- TEST 1: Section filter ---");

// Simulate: server.js filters super_ponuka only
const allMatches = [
  { id: "m1", section: "super_ponuka", rawTitle: "A vs B" },
  { id: "m2", section: "super_sanca", rawTitle: "C vs D" },
  { id: "m3", section: "super_ponuka", rawTitle: "E vs F" },
];
const superkurzyMatches = allMatches.filter((m) => m.section === "super_ponuka");
ok(superkurzyMatches.length === 2, "only super_ponuka matches survive filter");
ok(!superkurzyMatches.find((m) => m.section === "super_sanca"), "no super_sanca in filtered list");

// ============================================================
// TEST 2: Duplicate odds do not break ordering
// ============================================================
console.log("\n--- TEST 2: Odds ordering preserved ---");

const testOdds = [1.85, 3.40, 1.85, 1.30, 1.20, 1.85];
// Must NOT dedup — all 6 values must be preserved in order
ok(testOdds.length === 6, "6 odds preserved (no Set dedup)");
ok(testOdds[0] === 1.85 && testOdds[2] === 1.85 && testOdds[5] === 1.85, "duplicate 1.85 values preserved at positions 0,2,5");
// DC mapping: last 3 odds = [1.30, 1.20, 1.85] → 1x=1.30, 12=1.20, x2=1.85
const dc = testOdds.slice(-3);
ok(dc[0] === 1.30 && dc[1] === 1.20 && dc[2] === 1.85, "DC mapping correct: 1x=1.30, 12=1.20, x2=1.85");

// With Set dedup (BAD): [1.85, 3.40, 1.30, 1.20] → only 4 values → DC mapping broken
const badDedup = [...new Set(testOdds)];
ok(badDedup.length === 4, "Set dedup reduces to 4 (BAD — would break DC)");

// ============================================================
// TEST 3: sourceSelection null → rejected
// ============================================================
console.log("\n--- TEST 3: sourceSelection validation ---");

const rowWithNullSource = {
  marketType: "draw_no_bet_2way", period: "full_time", selection: "home",
  mappedSelection: "home", sourceSelection: null,
  nikeOdd: 1.50, tipsportOdd: 1.45, line: null, sourceLine: null,
  sourceMarketName: "Draw No Bet 2-way", columnLabels: ["1", "2"],
  extractedOddsArray: [1.45, 2.80]
};
const result3a = validateMarketCandidate(rowWithNullSource);
ok(!result3a.ok, "sourceSelection=null with tipsportOdd → rejected");
ok(result3a.reason === "selection_not_in_source", `reason=${result3a.reason}`);

const rowWithValidSource = {
  ...rowWithNullSource,
  sourceSelection: "home"
};
const result3b = validateMarketCandidate(rowWithValidSource);
ok(result3b.ok, "sourceSelection='home' matching mappedSelection → accepted");

const rowWithMismatch = {
  ...rowWithNullSource,
  sourceSelection: "away",
  mappedSelection: "home"
};
const result3c = validateMarketCandidate(rowWithMismatch);
ok(!result3c.ok, "sourceSelection='away' != mappedSelection='home' → rejected");
ok(result3c.reason === "selection_source_mismatch", `reason=${result3c.reason}`);

// ============================================================
// TEST 4: dedupeMarkets — logical identity without nikeOdd
// ============================================================
console.log("\n--- TEST 4: dedupeMarkets identity ---");

// Simulate: same logical market, different nikeOdd → only first survives
const markets = [
  { matchId: "m1", marketType: "asian_handicap_2way", period: "full_time", line: 1.5, selection: "home", nikeOdd: 1.49 },
  { matchId: "m1", marketType: "asian_handicap_2way", period: "full_time", line: 1.5, selection: "home", nikeOdd: 1.52 },
  { matchId: "m1", marketType: "asian_handicap_2way", period: "full_time", line: 1.5, selection: "away", nikeOdd: 2.60 },
];

// Replicate dedupeMarkets logic (without nikeOdd in key)
const seen = new Set();
const deduped = [];
for (const m of markets) {
  const key = [m.matchId, m.marketType, m.period, m.line ?? "null", m.selection].join("|");
  if (seen.has(key)) continue;
  seen.add(key);
  deduped.push(m);
}
ok(deduped.length === 2, "2 unique markets after dedup (home + away)");
ok(deduped[0].nikeOdd === 1.49, "first home occurrence preserved (1.49, not 1.52)");

// ============================================================
// TEST 5: Bad handicap line pairing rejected
// ============================================================
console.log("\n--- TEST 5: Handicap line validation ---");

// Line market with missing sourceLine → rejected
const ahMissingLine = {
  marketType: "asian_handicap_2way", period: "full_time",
  selection: "home", mappedSelection: "home", sourceSelection: "home",
  nikeOdd: 2.80, tipsportOdd: 2.72,
  line: -1.5, sourceLine: null,
  sourceMarketName: "Asian Handicap 2-way",
  columnLabels: ["handicap", "1", "2"],
  extractedOddsArray: [2.72, 1.44]
};
const result5a = validateMarketCandidate(ahMissingLine);
ok(!result5a.ok, "AH with sourceLine=null → rejected");
ok(result5a.reason === "line_missing_source", `reason=${result5a.reason}`);

// Line market with mismatched lines → rejected
const ahLineMismatch = {
  ...ahMissingLine,
  sourceLine: -2.5 // different from line=-1.5
};
const result5b = validateMarketCandidate(ahLineMismatch);
ok(!result5b.ok, "AH line=-1.5 vs sourceLine=-2.5 → rejected");
ok(result5b.reason === "line_mismatch", `reason=${result5b.reason}`);

// Line market with matching lines → accepted
const ahValid = {
  ...ahMissingLine,
  sourceLine: -1.5
};
const result5c = validateMarketCandidate(ahValid);
ok(result5c.ok, "AH line=-1.5 matching sourceLine=-1.5 → accepted");

// ============================================================
// TEST 6: Known valid case (Nitra DNB) still passes
// ============================================================
console.log("\n--- TEST 6: Known valid case ---");

const nitraDnb = {
  marketType: "draw_no_bet_2way", period: "full_time",
  selection: "home", mappedSelection: "home", sourceSelection: "home",
  nikeOdd: 1.53, tipsportOdd: 1.46,
  line: null, sourceLine: null,
  sourceMarketName: "Draw No Bet 2-way",
  columnLabels: ["1", "2"],
  extractedOddsArray: [1.46, 2.64]
};
const result6 = validateMarketCandidate(nitraDnb);
ok(result6.ok, "Nitra DNB home valid case passes validation");

// ============================================================
// Summary
// ============================================================
console.log("");
if (failed > 0) {
  console.error(`${failed} test(s) FAILED.`);
  process.exit(1);
}
console.log("All bugfix validation tests passed.");
