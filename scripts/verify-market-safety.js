import { isSafeDoubleChanceLabels, isSafeMatchWinner2WayLabels } from "../src/scrapers/flashscore.js";
import { validateMarketCandidate } from "../src/utils/pipeline-logic.js";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

if (!isSafeDoubleChanceLabels(["1X", "12", "X2"])) fail("double chance exact labels not accepted");
if (isSafeDoubleChanceLabels(["1", "X", "2"])) fail("double chance accepted 1X2 labels");
if (!isSafeMatchWinner2WayLabels(["1", "2"])) fail("winner 2-way exact labels not accepted");
if (isSafeMatchWinner2WayLabels(["1", "X", "2"])) fail("winner 2-way accepted 1X2 labels");

const wrongPeriod = validateMarketCandidate({
  marketType: "both_teams_to_score",
  period: "first_half",
  selection: "no",
  mappedSelection: "no",
  sourceSelection: "no",
  nikeOdd: 2.4,
  tipsportOdd: 2.3,
  line: null,
  sourceLine: null,
  sourceMarketName: "Both Teams To Score",
  columnLabels: ["yes", "no"],
  extractedOddsArray: [1.5, 2.3]
});
if (wrongPeriod.ok) fail("period safety failed; first_half unexpectedly accepted");

const wrongLine = validateMarketCandidate({
  marketType: "asian_handicap_2way",
  period: "full_time",
  selection: "home",
  mappedSelection: "home",
  sourceSelection: "home",
  nikeOdd: 1.5,
  tipsportOdd: 1.4,
  line: -1.5,
  sourceLine: -1.0,
  sourceMarketName: "Asian Handicap 2-way",
  columnLabels: ["handicap", "1", "2"],
  extractedOddsArray: [1.4, 2.8]
});
if (wrongLine.ok) fail("line safety failed; mismatched handicap line accepted");

console.log("OK: market safety checks passed");

