/**
 * Unit verification for all-2way-opportunities logic.
 *
 * Tests:
 *  1. compute2WayMarginPercent correctness
 *  2. compute3WayMarginPercent correctness
 *  3. getPairSelectionsForMarket returns correct pair types
 *  4. build2WayOpportunities: all matches represented
 *  5. build2WayOpportunities: margin computed from correct pair
 *  6. build2WayOpportunities: sort order ASC by nikeMarginPercent
 *  7. build2WayOpportunities: incomplete pairs produce null margin
 *  8. Final edges output is unaffected (validateFinalRows still passes on sorted edge rows)
 */
import {
  compute2WayMarginPercent,
  compute3WayMarginPercent,
  getPairSelectionsForMarket,
  validateFinalRows,
  computeMetrics,
  compareRows
} from "../src/utils/pipeline-logic.js";
import { build2WayOpportunities } from "../src/utils/all-2way-builder.js";

let passed = 0;
let failed = 0;

function ok(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function approxEq(a, b, tolerance = 0.01) {
  return Math.abs(a - b) < tolerance;
}

// ---------------------------------------------------------------------------
// 1. compute2WayMarginPercent
// ---------------------------------------------------------------------------
console.log("\n[1] compute2WayMarginPercent");
{
  // Perfect 50/50 market: 2.00 / 2.00 → margin = 0%
  const m1 = compute2WayMarginPercent(2.0, 2.0);
  ok("2.00 / 2.00 => 0.00%", approxEq(m1, 0.0), `got ${m1}`);

  // Typical bookmaker margin ~5%: 1.90 / 1.90
  // (1/1.9 + 1/1.9 - 1) * 100 = (0.5263 * 2 - 1) * 100 = 5.26%
  const m2 = compute2WayMarginPercent(1.9, 1.9);
  ok("1.90 / 1.90 ≈ 5.26%", approxEq(m2, 5.26, 0.05), `got ${m2}`);

  // Asymmetric: 2.5 / 1.6
  // (1/2.5 + 1/1.6 - 1) * 100 = (0.4 + 0.625 - 1) * 100 = 2.5%
  const m3 = compute2WayMarginPercent(2.5, 1.6);
  ok("2.50 / 1.60 ≈ 2.5%", approxEq(m3, 2.5, 0.05), `got ${m3}`);

  // Invalid odds → null
  ok("0 / 2.0 => null", compute2WayMarginPercent(0, 2.0) === null);
  ok("2.0 / null => null", compute2WayMarginPercent(2.0, null) === null);
  ok("1.0 / 2.0 => null (odd not > 1)", compute2WayMarginPercent(1.0, 2.0) === null);
}

// ---------------------------------------------------------------------------
// 2. compute3WayMarginPercent  (formula: sum(1/odd_i) - 1) * 100
// ---------------------------------------------------------------------------
console.log("\n[2] compute3WayMarginPercent");
{
  // Fair 3-way market: 3.00/3.00/3.00 → (1/3 + 1/3 + 1/3 - 1)*100 = 0%
  const m1 = compute3WayMarginPercent(3.0, 3.0, 3.0);
  ok("3.00/3.00/3.00 => 0%", approxEq(m1, 0.0, 0.02), `got ${m1}`);

  // Typical bookmaker overround: 2.5/3.2/2.9
  // (1/2.5 + 1/3.2 + 1/2.9 - 1)*100 = (0.4 + 0.3125 + 0.3448 - 1)*100 = 5.73%
  const m2 = compute3WayMarginPercent(2.5, 3.2, 2.9);
  ok("2.50/3.20/2.90 ≈ 5.73%", approxEq(m2, 5.73, 0.1), `got ${m2}`);

  ok("invalid => null", compute3WayMarginPercent(1.2, 1.0, 1.2) === null);
}

// ---------------------------------------------------------------------------
// 3. getPairSelectionsForMarket
// ---------------------------------------------------------------------------
console.log("\n[3] getPairSelectionsForMarket");
{
  const cases = [
    ["match_winner_2way", "home_away", ["home", "away"]],
    ["draw_no_bet_2way", "home_away", ["home", "away"]],
    ["asian_handicap_2way", "home_away", ["home", "away"]],
    ["european_handicap_2way", "home_away", ["home", "away"]],
    ["over_under_2way", "over_under", ["over", "under"]],
    ["both_teams_to_score", "yes_no", ["yes", "no"]],
    ["team_to_score_yes_no", "yes_no", ["yes", "no"]],
    ["generic_yes_no", "yes_no", ["yes", "no"]],
    ["double_chance", "double_chance_3way", ["1x", "12", "x2"]]
  ];
  for (const [mt, expectedType, expectedKeys] of cases) {
    const pair = getPairSelectionsForMarket(mt);
    ok(`${mt} => type=${expectedType}`, pair?.type === expectedType, `got ${pair?.type}`);
    ok(`${mt} => keys=${expectedKeys}`, JSON.stringify(pair?.keys) === JSON.stringify(expectedKeys), `got ${JSON.stringify(pair?.keys)}`);
  }
  ok("unknown market => null", getPairSelectionsForMarket("nonexistent_market") === null);
}

// ---------------------------------------------------------------------------
// Mock pipeline factory
// ---------------------------------------------------------------------------
function makeMockPipeline(matchList, controlRowList) {
  return { nike: { matches: matchList }, controlRows: controlRowList };
}

function makeMatch(id, rawTitle, sport = "football", tournament = "Test League") {
  return { id, rawTitle, sport, tournament, homeTeam: "Home", awayTeam: "Away", kickoffAt: "2026-03-20T18:00:00Z" };
}

function makeControlRow(matchId, match, marketType, selection, nikeOdd, tipsportOdd, status = "MATCHED") {
  return {
    matchId,
    match,
    kickoffAt: "2026-03-20T18:00:00Z",
    sport: "football",
    marketType,
    rawMarketName: marketType,
    selection,
    period: "full_time",
    line: null,
    nikeOdd,
    tipsportOdd,
    status,
    compareReason: status === "MATCHED" ? "nike_gt_tipsport" : status.toLowerCase(),
    sourceType: "network_first"
  };
}

// ---------------------------------------------------------------------------
// 4. All matches represented in output
// ---------------------------------------------------------------------------
console.log("\n[4] All matches represented in output");
{
  const match1 = makeMatch("m1", "Team A vs Team B");
  const match2 = makeMatch("m2", "Team C vs Team D");
  const rows = [
    makeControlRow("m1", "Team A vs Team B", "match_winner_2way", "home", 2.5, 2.3),
    makeControlRow("m1", "Team A vs Team B", "match_winner_2way", "away", 1.6, 1.5),
    makeControlRow("m2", "Team C vs Team D", "over_under_2way", "over", 1.9, 1.85),
    makeControlRow("m2", "Team C vs Team D", "over_under_2way", "under", 1.9, 1.85)
  ];
  const pipeline = makeMockPipeline([match1, match2], rows);
  const result = build2WayOpportunities(pipeline);
  const matchIds = new Set(result.map((r) => r.matchId));
  ok("match m1 present", matchIds.has("m1"));
  ok("match m2 present", matchIds.has("m2"));
  ok("all 4 rows emitted", result.length === 4, `got ${result.length}`);
}

// ---------------------------------------------------------------------------
// 5. Margin computed from correct pair
// ---------------------------------------------------------------------------
console.log("\n[5] Margin computed from correct pair");
{
  const match1 = makeMatch("m1", "X vs Y");
  // home=2.5 away=1.6 → margin = (1/2.5 + 1/1.6 - 1)*100 = 2.5%
  const rows = [
    makeControlRow("m1", "X vs Y", "match_winner_2way", "home", 2.5, 2.3),
    makeControlRow("m1", "X vs Y", "match_winner_2way", "away", 1.6, 1.5)
  ];
  const pipeline = makeMockPipeline([match1], rows);
  const result = build2WayOpportunities(pipeline);
  const nikeMargins = [...new Set(result.map((r) => r.nikeMarginPercent))];
  ok("single group gets single nikeMarginPercent", nikeMargins.length === 1, `got margins: ${nikeMargins}`);
  ok("nikeMarginPercent ≈ 2.5%", approxEq(nikeMargins[0], 2.5, 0.05), `got ${nikeMargins[0]}`);

  // Both rows in group share same margin
  ok("home row has correct margin", approxEq(result.find(r => r.selection === "home")?.nikeMarginPercent, 2.5, 0.05));
  ok("away row has correct margin", approxEq(result.find(r => r.selection === "away")?.nikeMarginPercent, 2.5, 0.05));

  // tournament propagated from match metadata
  ok("tournament propagated", result[0].tournament === "Test League", `got ${result[0].tournament}`);
}

// ---------------------------------------------------------------------------
// 6. Sort order: nikeMarginPercent ASC, nulls last
// ---------------------------------------------------------------------------
console.log("\n[6] Sort order ASC by nikeMarginPercent, nulls last");
{
  const m1 = makeMatch("m1", "Alpha");
  const m2 = makeMatch("m2", "Beta");
  const m3 = makeMatch("m3", "Gamma");
  // m1: over/under 1.9/1.9 → margin ~5.26%
  // m2: winner 2.5/1.6 → margin ~2.5%
  // m3: incomplete (only home, no away) → margin null
  const rows = [
    makeControlRow("m1", "Alpha", "over_under_2way", "over", 1.9, 1.85),
    makeControlRow("m1", "Alpha", "over_under_2way", "under", 1.9, 1.85),
    makeControlRow("m2", "Beta", "match_winner_2way", "home", 2.5, 2.3),
    makeControlRow("m2", "Beta", "match_winner_2way", "away", 1.6, 1.5),
    makeControlRow("m3", "Gamma", "match_winner_2way", "home", 2.0, null, "NIKE_ONLY")
  ];
  const pipeline = makeMockPipeline([m1, m2, m3], rows);
  const result = build2WayOpportunities(pipeline);

  // Extract unique margins in output order
  const seen = new Set();
  const orderedMargins = [];
  for (const r of result) {
    const key = `${r.matchId}|${r.nikeMarginPercent}`;
    if (!seen.has(key)) { seen.add(key); orderedMargins.push(r.nikeMarginPercent); }
  }
  const nullsAtEnd = orderedMargins.every((v, i) => {
    if (v == null) return orderedMargins.slice(i).every((x) => x == null);
    return true;
  });
  ok("nulls at end", nullsAtEnd, `order: ${JSON.stringify(orderedMargins)}`);

  const nonNulls = orderedMargins.filter((v) => v != null);
  const sorted = [...nonNulls].sort((a, b) => a - b);
  ok("non-null margins sorted ASC", JSON.stringify(nonNulls) === JSON.stringify(sorted), `got ${JSON.stringify(nonNulls)}`);
}

// ---------------------------------------------------------------------------
// 7. Incomplete pairs → null margin with marginNote
// ---------------------------------------------------------------------------
console.log("\n[7] Incomplete pairs have null margin + marginNote");
{
  const m1 = makeMatch("m1", "Solo");
  // Only home row present, no away
  const rows = [
    makeControlRow("m1", "Solo", "match_winner_2way", "home", 2.0, null, "NIKE_ONLY")
  ];
  const pipeline = makeMockPipeline([m1], rows);
  const result = build2WayOpportunities(pipeline);
  ok("nikeMarginPercent is null", result[0]?.nikeMarginPercent === null, `got ${result[0]?.nikeMarginPercent}`);
  ok("marginNote is set", result[0]?.marginNote != null && result[0].marginNote.length > 0, `got ${result[0]?.marginNote}`);

  // double_chance: margin is always null (not applicable for 3 correlated selections)
  const m2 = makeMatch("m2", "DC Full");
  const rows2 = [
    makeControlRow("m2", "DC Full", "double_chance", "1x", 1.3, 1.25),
    makeControlRow("m2", "DC Full", "double_chance", "12", 2.8, 2.7),
    makeControlRow("m2", "DC Full", "double_chance", "x2", 1.3, 1.25)
  ];
  const p2 = makeMockPipeline([m2], rows2);
  const res2 = build2WayOpportunities(p2);
  ok("double_chance => nikeMarginPercent always null", res2.every((r) => r.nikeMarginPercent === null));
  ok("double_chance => marginNote set to not_applicable", res2.every((r) => r.marginNote === "margin_not_applicable_double_chance_3way"));
}

// ---------------------------------------------------------------------------
// 8. Final edges logic unaffected (validateFinalRows still works)
// ---------------------------------------------------------------------------
console.log("\n[8] validateFinalRows unaffected");
{
  const m = { nikeOdd: 2.5, tipsportOdd: 2.3, match: "X vs Y", selection: "home" };
  const metrics = computeMetrics(m.nikeOdd, m.tipsportOdd);
  const edge = { ...m, ...metrics };
  const edges = [edge];
  const sorted = [...edges].sort(compareRows);
  const validation = validateFinalRows(sorted);
  ok("validateFinalRows still ok for basic edge", validation.ok, JSON.stringify(validation.errors));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(50)}`);
console.log(`verify:all-2way-opportunities: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
