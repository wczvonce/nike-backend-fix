import { validateMarketCandidate, computeMetrics, isNikeGreaterThanTipsport } from "../src/utils/pipeline-logic.js";

function ensureComparable(row, label) {
  const validation = validateMarketCandidate(row);
  if (!validation.ok) {
    console.error("FAIL:", label, "validation rejected:", validation.reason);
    process.exit(1);
  }
  if (!isNikeGreaterThanTipsport(row.nikeOdd, row.tipsportOdd)) {
    console.error("FAIL:", label, "nike not greater than tipsport");
    process.exit(1);
  }
  const m = computeMetrics(row.nikeOdd, row.tipsportOdd);
  if (!(m.diff > 0 && m.probabilityEdgePp > 0)) {
    console.error("FAIL:", label, "metrics did not produce positive edge");
    process.exit(1);
  }
}

ensureComparable({
  marketType: "both_teams_to_score",
  period: "full_time",
  line: null,
  sourceLine: null,
  selection: "no",
  mappedSelection: "no",
  sourceSelection: "no",
  nikeOdd: 2.47,
  tipsportOdd: 2.45,
  sourceMarketName: "Both Teams To Score",
  columnLabels: ["yes", "no"],
  extractedOddsArray: [1.53, 2.45]
}, "BTTS NO edge case");

ensureComparable({
  marketType: "asian_handicap_2way",
  period: "full_time",
  line: -1.5,
  sourceLine: -1.5,
  selection: "away",
  mappedSelection: "away",
  sourceSelection: "away",
  nikeOdd: 1.39,
  tipsportOdd: 1.37,
  sourceMarketName: "Asian Handicap 2-way",
  columnLabels: ["handicap", "1", "2"],
  extractedOddsArray: [3.1, 1.37]
}, "Asian handicap line edge case");

ensureComparable({
  marketType: "draw_no_bet_2way",
  period: "full_time",
  line: null,
  sourceLine: null,
  selection: "home",
  mappedSelection: "home",
  sourceSelection: "home",
  nikeOdd: 1.42,
  tipsportOdd: 1.41,
  sourceMarketName: "Draw No Bet 2-way",
  columnLabels: ["1", "2"],
  extractedOddsArray: [1.41, 2.95]
}, "DNB home edge case");

ensureComparable({
  marketType: "match_winner_2way",
  period: "full_time",
  line: null,
  sourceLine: null,
  selection: "home",
  mappedSelection: "home",
  sourceSelection: "home",
  nikeOdd: 1.68,
  tipsportOdd: 1.66,
  sourceMarketName: "Match Winner 2-way",
  columnLabels: ["1", "2"],
  extractedOddsArray: [1.66, 2.35]
}, "Tennis winner edge case");

ensureComparable({
  marketType: "double_chance",
  period: "full_time",
  line: null,
  sourceLine: null,
  selection: "1x",
  mappedSelection: "1x",
  sourceSelection: "1x",
  nikeOdd: 1.31,
  tipsportOdd: 1.29,
  sourceMarketName: "Double Chance",
  columnLabels: ["1X", "12", "X2"],
  extractedOddsArray: [1.29, 1.35, 1.83]
}, "Double chance edge case");

console.log("OK: missed edge case regression fixtures passed");

