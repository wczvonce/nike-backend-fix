/**
 * Run: node scripts/test-parser-fixtures.js
 * Deterministic fixture tests for Flashscore table normalization.
 */
import { normalizeFlashscoreMarketSnapshot } from "../src/scrapers/flashscore.js";
import { getMarketHandler } from "../src/markets/handlers.js";

let failed = 0;
function eq(actual, expected, msg) {
  if (actual !== expected) {
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

function runSnapshot(marketType, snapshot) {
  const h = getMarketHandler(marketType);
  return normalizeFlashscoreMarketSnapshot(
    snapshot,
    {
      marketType: h.marketType,
      marketName: h.displayName,
      expectedLabels: h.expectedLabels,
      labelAliases: h.labelAliases,
      requireExactLabelSet: h.requireExactLabelSet,
      expectedOddCount: h.expectedOddCount,
      requireLine: h.requireLine
    },
    "fixture://test"
  );
}

console.log("--- fixture parser guards ---");
const dcValid = runSnapshot("double_chance", {
  labels: ["1X", "12", "X2"],
  rows: [{ bookmaker: "Tipsport.sk", oddTexts: ["1.29", "1.35", "1.83"], lineText: "", rawRowText: "1.291.351.83" }]
});
eq(dcValid.bookmakerRows.length, 1, "double chance valid fixture parsed");

const dcWrongTable = runSnapshot("double_chance", {
  labels: ["1", "X", "2"],
  rows: [{ bookmaker: "Tipsport.sk", oddTexts: ["1.84", "4.22", "4.02"], lineText: "", rawRowText: "1.844.224.02" }]
});
eq(dcWrongTable.bookmakerRows.length, 0, "double chance rejects 1X2-like table fixture");

const winnerWrongTable = runSnapshot("match_winner_2way", {
  labels: ["1", "X", "2"],
  rows: [{ bookmaker: "Tipsport.sk", oddTexts: ["1.84", "4.22", "4.02"], lineText: "", rawRowText: "1.844.224.02" }]
});
eq(winnerWrongTable.bookmakerRows.length, 0, "winner 2-way rejects 1X2 fixture");

const winnerValid = runSnapshot("match_winner_2way", {
  labels: ["1", "2"],
  rows: [{ bookmaker: "Tipsport.sk", oddTexts: ["1.66", "2.35"], lineText: "", rawRowText: "1.662.35" }]
});
eq(winnerValid.bookmakerRows.length, 1, "winner 2-way valid fixture parsed");

const ouNeedsLine = runSnapshot("over_under_2way", {
  labels: ["Celkom", "Over", "Under"],
  rows: [{ bookmaker: "Tipsport.sk", oddTexts: ["1.88", "1.95"], lineText: "", rawRowText: "1.881.95" }]
});
eq(ouNeedsLine.bookmakerRows.length, 0, "over/under requires line and rejects row without line");

const ahLineFallback = runSnapshot("asian_handicap_2way", {
  labels: ["Handicap", "1", "2"],
  rows: [{ bookmaker: "Tipsport.sk", oddTexts: ["6.08", "1.14"], lineText: "", rawRowText: "-2.56.081.14" }]
});
eq(ahLineFallback.bookmakerRows.length, 1, "asian handicap can parse merged line fallback");
ok(ahLineFallback.bookmakerRows[0].line != null, "asian handicap line extracted");

if (failed > 0) {
  console.error("\nTotal failures:", failed);
  process.exit(1);
}
console.log("\nAll checks passed.");

