/**
 * Regression test for double_chance selection swap bug.
 *
 * BUG: Michalovce vs HK Nitra, hockey, double_chance, selection 1x.
 *   Flashscore.sk shows Tipsport 1x = 1.87, app shows Tipsport 1x = 1.30 (which is x2).
 *   Root cause: isSwappedOrientation used search-page team names that could
 *   disagree with the odds-page team ordering, causing a false-positive swap
 *   that mapped Nike "1x" → Flashscore "x2".
 *
 * FIX: For double_chance, override the swap flag using participantDomOrder
 *   from the actual odds page (authoritative source for 1/X/2 assignment).
 *
 * Run: node scripts/test-dc-swap-fix.js
 */
import { normalizeForCompare, mapSelectionForSwap } from "../src/utils/pipeline-logic.js";

let failed = 0;
function ok(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else { console.log("OK:", msg); }
}

// -- Replicate the similarity function from server.js --
function similarity(a, b) {
  const x = normalizeForCompare(a);
  const y = normalizeForCompare(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const xTokens = new Set(x.split(" ").filter(Boolean));
  const yTokens = new Set(y.split(" ").filter(Boolean));
  const inter = [...xTokens].filter((t) => yTokens.has(t)).length;
  if (!inter) return 0;
  return inter / Math.max(xTokens.size, yTokens.size);
}

function isSwappedOrientation(nikeMatch, fsMatch) {
  const straight = similarity(nikeMatch.homeTeam, fsMatch.homeTeam)
    + similarity(nikeMatch.awayTeam, fsMatch.awayTeam);
  const swapped = similarity(nikeMatch.homeTeam, fsMatch.awayTeam)
    + similarity(nikeMatch.awayTeam, fsMatch.homeTeam);
  return swapped > straight + 0.05;
}

/**
 * Replicate the new dcSwapped logic from server.js
 */
function resolveDcSwapped(swapped, nikeMatch, participantDomOrder) {
  if (participantDomOrder?.length >= 2) {
    const domStraight = similarity(nikeMatch.homeTeam, participantDomOrder[0])
      + similarity(nikeMatch.awayTeam, participantDomOrder[1]);
    const domSwappedSim = similarity(nikeMatch.homeTeam, participantDomOrder[1])
      + similarity(nikeMatch.awayTeam, participantDomOrder[0]);
    return domSwappedSim > domStraight + 0.05;
  }
  return swapped;
}

// ============================================================
// SCENARIO 1: Bug scenario — search gives wrong swap, DOM fixes it
//
// Nike:       "Michalovce" vs "HK Nitra"    (Michalovce = home)
// FS search:  "HK Nitra" vs "Michalovce"    (search matched entities in this order)
// FS page:    "Michalovce" vs "HK Nitra"    (actual odds page display matches Nike)
//
// OLD behavior: isSwappedOrientation = true (search says teams reversed)
//               mapSelectionForSwap("1x", true) → "x2" → gets 1.30 (WRONG)
// NEW behavior: dcSwapped uses participantDomOrder ["Michalovce","HK Nitra"]
//               dcSwapped = false → mapSelectionForSwap("1x", false) → "1x" → gets 1.87 (CORRECT)
// ============================================================
console.log("--- SCENARIO 1: false-positive swap corrected by participantDomOrder ---");

const nikeMatch1 = { homeTeam: "Michalovce", awayTeam: "HK Nitra" };
const fsSearch1 = { homeTeam: "HK Nitra", awayTeam: "Michalovce" };
const pageDomOrder1 = ["Michalovce", "HK Nitra"];

const searchSwapped1 = isSwappedOrientation(nikeMatch1, fsSearch1);
ok(searchSwapped1 === true, "search-level swap is TRUE (search says teams reversed)");

const dcSwapped1 = resolveDcSwapped(searchSwapped1, nikeMatch1, pageDomOrder1);
ok(dcSwapped1 === false, "dcSwapped overridden to FALSE by participantDomOrder");

const mapped1x_old = mapSelectionForSwap("1x", searchSwapped1);
ok(mapped1x_old === "x2", "OLD: Nike 1x → x2 (wrong lookup, would get 1.30)");

const mapped1x_new = mapSelectionForSwap("1x", dcSwapped1);
ok(mapped1x_new === "1x", "NEW: Nike 1x → 1x (correct lookup, gets 1.87)");

// Simulate the actual odds lookup
const tipsportSelectionOdds1 = { "1x": 1.87, "12": 1.50, "x2": 1.30 };
ok(tipsportSelectionOdds1[mapped1x_old] === 1.30, "OLD: tipsportOdd = 1.30 (BUG — x2 value)");
ok(tipsportSelectionOdds1[mapped1x_new] === 1.87, "NEW: tipsportOdd = 1.87 (CORRECT — 1x value)");

// Also verify x2 and 12
const mappedX2_new = mapSelectionForSwap("x2", dcSwapped1);
ok(mappedX2_new === "x2", "NEW: Nike x2 → x2 (correct)");
ok(tipsportSelectionOdds1[mappedX2_new] === 1.30, "NEW: tipsportOdd for x2 = 1.30 (correct)");

const mapped12_new = mapSelectionForSwap("12", dcSwapped1);
ok(mapped12_new === "12", "NEW: Nike 12 → 12 (12 never changes)");
ok(tipsportSelectionOdds1[mapped12_new] === 1.50, "NEW: tipsportOdd for 12 = 1.50 (correct)");

// ============================================================
// SCENARIO 2: Genuinely swapped teams — both search and DOM agree
//
// Nike:     "Michalovce" vs "HK Nitra"
// FS page:  "HK Nitra" vs "Michalovce"  (teams genuinely reversed)
// ============================================================
console.log("\n--- SCENARIO 2: genuinely swapped teams — swap IS needed ---");

const nikeMatch2 = { homeTeam: "Michalovce", awayTeam: "HK Nitra" };
const fsSearch2 = { homeTeam: "HK Nitra", awayTeam: "Michalovce" };
const pageDomOrder2 = ["HK Nitra", "Michalovce"];

const searchSwapped2 = isSwappedOrientation(nikeMatch2, fsSearch2);
ok(searchSwapped2 === true, "search-level swap is TRUE");

const dcSwapped2 = resolveDcSwapped(searchSwapped2, nikeMatch2, pageDomOrder2);
ok(dcSwapped2 === true, "dcSwapped stays TRUE (DOM also confirms swap)");

// On the FS page "HK Nitra vs Michalovce":
//   1x = "HK Nitra or draw" = 1.87
//   x2 = "draw or Michalovce" = 1.30
// Nike 1x = "Michalovce or draw" → should map to FS x2 = 1.30
const tipsportSelectionOdds2 = { "1x": 1.87, "12": 1.50, "x2": 1.30 };
const mapped2_1x = mapSelectionForSwap("1x", dcSwapped2);
ok(mapped2_1x === "x2", "Nike 1x → x2 (correct swap for genuinely reversed teams)");
ok(tipsportSelectionOdds2[mapped2_1x] === 1.30, "tipsportOdd = 1.30 (correct — Michalovce or draw from FS perspective)");

const mapped2_x2 = mapSelectionForSwap("x2", dcSwapped2);
ok(mapped2_x2 === "1x", "Nike x2 → 1x (correct swap)");
ok(tipsportSelectionOdds2[mapped2_x2] === 1.87, "tipsportOdd = 1.87 (correct — HK Nitra or draw from FS perspective)");

// ============================================================
// SCENARIO 3: Same order on both sides — no swap at all
// ============================================================
console.log("\n--- SCENARIO 3: same order, no swap ---");

const nikeMatch3 = { homeTeam: "Michalovce", awayTeam: "HK Nitra" };
const fsSearch3 = { homeTeam: "Michalovce", awayTeam: "HK Nitra" };
const pageDomOrder3 = ["Michalovce", "HK Nitra"];

const searchSwapped3 = isSwappedOrientation(nikeMatch3, fsSearch3);
ok(searchSwapped3 === false, "search-level swap is FALSE");

const dcSwapped3 = resolveDcSwapped(searchSwapped3, nikeMatch3, pageDomOrder3);
ok(dcSwapped3 === false, "dcSwapped is FALSE");

const mapped3 = mapSelectionForSwap("1x", dcSwapped3);
ok(mapped3 === "1x", "1x stays 1x");

// ============================================================
// SCENARIO 4: participantDomOrder missing — fallback to search-level swap
// ============================================================
console.log("\n--- SCENARIO 4: no participantDomOrder — fallback to search swap ---");

const dcSwapped4a = resolveDcSwapped(true, nikeMatch1, []);
ok(dcSwapped4a === true, "empty participantDomOrder → keeps search-level swapped=true");

const dcSwapped4b = resolveDcSwapped(false, nikeMatch1, null);
ok(dcSwapped4b === false, "null participantDomOrder → keeps search-level swapped=false");

const dcSwapped4c = resolveDcSwapped(true, nikeMatch1, undefined);
ok(dcSwapped4c === true, "undefined participantDomOrder → keeps search-level swapped=true");

const dcSwapped4d = resolveDcSwapped(false, nikeMatch1, ["OnlyOneTeam"]);
ok(dcSwapped4d === false, "single-element participantDomOrder → keeps search-level swapped=false");

// ============================================================
// SCENARIO 5: Partial team name matches (HK prefix common in Slovak hockey)
// ============================================================
console.log("\n--- SCENARIO 5: partial team name matching ---");

const nikeMatch5 = { homeTeam: "HK Dukla Michalovce", awayTeam: "HK Nitra" };
const pageDomOrder5 = ["Dukla Michalovce", "HK Nitra"];

const dcSwapped5 = resolveDcSwapped(false, nikeMatch5, pageDomOrder5);
ok(dcSwapped5 === false, "partial match 'HK Dukla Michalovce' vs 'Dukla Michalovce' — no swap");

const pageDomOrder5r = ["HK Nitra", "Dukla Michalovce"];
const dcSwapped5r = resolveDcSwapped(false, nikeMatch5, pageDomOrder5r);
ok(dcSwapped5r === true, "reversed partial match — correctly detects swap");

// ============================================================
// SCENARIO 6: home/away markets should NOT be affected by dcSwapped
// mapSelectionForSwap for home/away still uses the original swapped flag
// ============================================================
console.log("\n--- SCENARIO 6: home/away markets unaffected ---");

// Even if dcSwapped differs, home/away markets should use the original swapped flag
ok(mapSelectionForSwap("home", true) === "away", "home → away when swapped=true");
ok(mapSelectionForSwap("away", true) === "home", "away → home when swapped=true");
ok(mapSelectionForSwap("home", false) === "home", "home → home when swapped=false");
ok(mapSelectionForSwap("away", false) === "away", "away → away when swapped=false");

// ============================================================
// SCENARIO 7: similarity edge cases with "HK" prefix
// ============================================================
console.log("\n--- SCENARIO 7: similarity edge cases ---");

// Both teams have "HK" prefix — ensure no cross-matching confusion
const sim_hk_hk = similarity("HK Michalovce", "HK Nitra");
ok(sim_hk_hk < 0.6, `similarity("HK Michalovce","HK Nitra") = ${sim_hk_hk.toFixed(3)} < 0.6 — not confused`);

const sim_exact = similarity("HK Nitra", "HK Nitra");
ok(sim_exact === 1, "exact match = 1");

const sim_partial = similarity("Dukla Michalovce", "HK Dukla Michalovce");
ok(sim_partial >= 0.6, `partial match = ${sim_partial.toFixed(3)} >= 0.6`);

const sim_none = similarity("Michalovce", "Nitra");
ok(sim_none === 0, "no token overlap = 0");

// ============================================================
// SCENARIO 8: the "12" selection should never be swapped
// ============================================================
console.log("\n--- SCENARIO 8: 12 never swaps ---");

ok(mapSelectionForSwap("12", false) === "12", "12 + no swap = 12");
ok(mapSelectionForSwap("12", true) === "12", "12 + swapped = 12 (home-or-away is symmetric)");

// ============================================================
// Summary
// ============================================================
console.log("");
if (failed > 0) {
  console.error(`${failed} test(s) FAILED.`);
  process.exit(1);
}
console.log("All double_chance swap regression tests passed.");
