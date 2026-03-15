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
        // HOME_DRAW_AWAY reference needed so resolveParticipantRoles can derive homeId/awayId.
        {
          bookmakerId: 411,
          bettingType: "HOME_DRAW_AWAY",
          bettingScope: "FULL_TIME",
          odds: [
            { value: "2.7", active: true, eventParticipantId: "HOME_TEAM_PID", handicap: null },
            { value: "3.5", active: true, eventParticipantId: null, handicap: null },
            { value: "2.3", active: true, eventParticipantId: "AWAY_TEAM_PID", handicap: null }
          ]
        },
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
            { value: "1.66", active: true, eventParticipantId: "HOME_TEAM_PID", handicap: null },
            { value: "2.35", active: true, eventParticipantId: "AWAY_TEAM_PID", handicap: null }
          ]
        },
        {
          bookmakerId: 411,
          bettingType: "DRAW_NO_BET",
          bettingScope: "FULL_TIME",
          odds: [
            { value: "2.08", active: true, eventParticipantId: "HOME_TEAM_PID", handicap: null },
            { value: "1.74", active: true, eventParticipantId: "AWAY_TEAM_PID", handicap: null }
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
            { value: "1.71", active: true, eventParticipantId: "HOME_TEAM_PID", handicap: null },
            { value: "2.15", active: true, eventParticipantId: "AWAY_TEAM_PID", handicap: null }
          ]
        }
      ]
    }
  }
};

function normalizeFromFixture(marketType, period = "full_time", extraCtx = {}) {
  const h = getMarketHandler(marketType);
  const snapshot = parseGraphqlOddsToSnapshot(fixturePayload, { marketType, period, marketName: h.displayName }, extraCtx);
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
ok(winner.bookmakerRows[0].extractedOddsArray[0] === 1.66, "winner first odd (home) parsed correctly");
ok(winner.bookmakerRows[0].selectionOdds?.home === 1.66, "winner home odd from participantId mapping");
ok(winner.bookmakerRows[0].selectionOdds?.away === 2.35, "winner away odd from participantId mapping");
ok(winner.bookmakerRows[0].selectionConfidence === "explicit", "winner selectionConfidence is explicit via participantId");

const ou = normalizeFromFixture("over_under_2way");
ok(ou.bookmakerRows.length === 1, "graphql parser yields over/under row");
ok(ou.bookmakerRows[0].line === 2.5, "over/under line extracted from handicap");

const winnerFirstSet = normalizeFromFixture("match_winner_2way", "first_set");
ok(winnerFirstSet.bookmakerRows.length === 1, "period filter keeps first_set winner row");
ok(winnerFirstSet.bookmakerRows[0].extractedOddsArray[1] === 2.15, "first_set second odd (away) parsed correctly");

// --- Michalovce Draw No Bet regression fixture ---
// Critical: home = 2.08 (Michalovce), away = 1.74 (Spišská N. Ves)
// Must map correctly via eventParticipantId, never by array index alone.
const dnb = normalizeFromFixture("draw_no_bet_2way");
ok(dnb.bookmakerRows.length === 1, "DNB: graphql parser yields draw_no_bet row");
const dnbRow = dnb.bookmakerRows[0];
ok(dnbRow?.selectionOdds?.home === 2.08, "DNB: home odd correctly mapped to 2.08 (Michalovce)");
ok(dnbRow?.selectionOdds?.away === 1.74, "DNB: away odd correctly mapped to 1.74 (Spišská N. Ves)");
ok(dnbRow?.selectionConfidence === "explicit", "DNB: selectionConfidence is explicit (participantId-based)");

// Verify that away (1.74) is NOT compared as 2.08 and home (2.08) is NOT 1.74.
ok(dnbRow?.selectionOdds?.home !== 1.74, "DNB: home is not 1.74 (guard against swapped assignment)");
ok(dnbRow?.selectionOdds?.away !== 2.08, "DNB: away is not 2.08 (guard against swapped assignment)");

// --- Home/away index-only payload (no participantId) — must use derived fallback ---
const noIdPayload = {
  data: {
    findOddsByEventId: {
      settings: { bookmakers: [{ bookmaker: { id: 411, name: "Tipsport.sk" } }] },
      odds: [{
        bookmakerId: 411,
        bettingType: "DRAW_NO_BET",
        bettingScope: "FULL_TIME",
        odds: [
          { value: "1.90", active: true, eventParticipantId: null, handicap: null },
          { value: "1.85", active: true, eventParticipantId: null, handicap: null }
        ]
      }]
    }
  }
};
const h = getMarketHandler("draw_no_bet_2way");
const noIdSnapshot = parseGraphqlOddsToSnapshot(noIdPayload, { marketType: "draw_no_bet_2way", period: "full_time", marketName: h.displayName });
const noIdNorm = normalizeFlashscoreMarketSnapshot(noIdSnapshot, { marketType: "draw_no_bet_2way", marketName: h.displayName, expectedLabels: h.expectedLabels, labelAliases: h.labelAliases, requireExactLabelSet: h.requireExactLabelSet, expectedOddCount: h.expectedOddCount, requireLine: h.requireLine, period: "full_time" }, "fixture://no-id");
ok(noIdNorm.bookmakerRows.length === 1, "DNB no-id: derived fallback produces a row");
ok(noIdNorm.bookmakerRows[0].selectionConfidence === "derived", "DNB no-id: selectionConfidence is derived (index-based)");
ok(noIdNorm.bookmakerRows[0].selectionOdds?.home === 1.90, "DNB no-id: home=index0=1.90");
ok(noIdNorm.bookmakerRows[0].selectionOdds?.away === 1.85, "DNB no-id: away=index1=1.85");

if (failed > 0) {
  console.error("\nTotal failures:", failed);
  process.exit(1);
}
console.log("All checks passed.");

