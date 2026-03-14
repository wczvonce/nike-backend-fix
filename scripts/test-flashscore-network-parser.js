import { normalizeFlashscoreMarketSnapshot, parseGraphqlOddsToSnapshot } from "../src/scrapers/flashscore.js";
import { getMarketHandler } from "../src/markets/handlers.js";

let failed = 0;
function ok(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

const fixturePayload = {
  data: {
    findOddsByEventId: {
      settings: {
        bookmakers: [
          { bookmaker: { id: 411, name: "Tipsport.sk" } },
          { bookmaker: { id: 293, name: "Fortuna SK" } }
        ]
      },
      odds: [
        {
          bookmakerId: 411,
          bettingType: "DOUBLE_CHANCE",
          bettingScope: "FULL_TIME",
          odds: [
            { value: "1.29", active: true, selection: "1X", handicap: null },
            { value: "1.35", active: true, selection: "12", handicap: null },
            { value: "1.83", active: true, selection: "X2", handicap: null }
          ]
        },
        {
          bookmakerId: 411,
          bettingType: "HOME_AWAY",
          bettingScope: "FULL_TIME",
          odds: [
            { value: "1.66", active: true, handicap: null },
            { value: "2.35", active: true, handicap: null }
          ]
        },
        {
          bookmakerId: 411,
          bettingType: "OVER_UNDER",
          bettingScope: "FULL_TIME",
          odds: [
            { value: "1.88", active: true, selection: "OVER", handicap: "2.5" },
            { value: "1.95", active: true, selection: "UNDER", handicap: "2.5" }
          ]
        },
        {
          bookmakerId: 411,
          bettingType: "HOME_AWAY",
          bettingScope: "FIRST_SET",
          odds: [
            { value: "1.71", active: true, handicap: null },
            { value: "2.15", active: true, handicap: null }
          ]
        }
      ]
    }
  }
};

function normalizeFromFixture(marketType, period = "full_time") {
  const h = getMarketHandler(marketType);
  const snapshot = parseGraphqlOddsToSnapshot(fixturePayload, { marketType, period, marketName: h.displayName });
  return normalizeFlashscoreMarketSnapshot(
    snapshot,
    {
      marketType: h.marketType,
      marketName: h.displayName,
      expectedLabels: h.expectedLabels,
      labelAliases: h.labelAliases,
      requireExactLabelSet: h.requireExactLabelSet,
      expectedOddCount: h.expectedOddCount,
      requireLine: h.requireLine,
      period
    },
    "fixture://graphql"
  );
}

const dc = normalizeFromFixture("double_chance");
ok(dc.bookmakerRows.length === 1, "graphql parser yields one double chance bookmaker row");
ok(dc.bookmakerRows[0].extractedOddsArray.length === 3, "double chance keeps 3 exact odds");

const winner = normalizeFromFixture("match_winner_2way");
ok(winner.bookmakerRows.length === 1, "graphql parser yields winner 2-way row");
ok(winner.bookmakerRows[0].extractedOddsArray[0] === 1.66, "winner first odd parsed correctly");

const ou = normalizeFromFixture("over_under_2way");
ok(ou.bookmakerRows.length === 1, "graphql parser yields over/under row");
ok(ou.bookmakerRows[0].line === 2.5, "over/under line extracted from handicap");

const winnerFirstSet = normalizeFromFixture("match_winner_2way", "first_set");
ok(winnerFirstSet.bookmakerRows.length === 1, "period filter keeps first_set winner row");
ok(winnerFirstSet.bookmakerRows[0].extractedOddsArray[1] === 2.15, "first_set second odd parsed correctly");

if (failed > 0) process.exit(1);
console.log("All checks passed.");
