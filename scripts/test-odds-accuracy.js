/**
 * Deterministic accuracy regression tests for home/away odds mapping.
 * Run: node scripts/test-odds-accuracy.js
 * No server/network required — pure fixture tests.
 */
import { parseGraphqlOddsToSnapshot, normalizeFlashscoreMarketSnapshot } from "../src/scrapers/flashscore.js";
import { getMarketHandler } from "../src/markets/handlers.js";
import { validateMarketCandidate, isNikeGreaterThanTipsport } from "../src/utils/pipeline-logic.js";

let failed = 0;
function ok(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else { console.log("OK:", msg); }
}
function fail(msg) { failed++; console.error("FAIL:", msg); }

// ============================================================
// FIXTURE: Michalovce vs Spišská N. Ves — draw_no_bet_2way
// Expected: HOME (Michalovce) = 2.08, AWAY (Spišská) = 1.74
// ============================================================
const michalovcePayload = {
  data: {
    findOddsByEventId: {
      settings: { bookmakers: [{ bookmaker: { id: 411, name: "Tipsport.sk" } }, { bookmaker: { id: 20, name: "Nike.sk" } }] },
      odds: [
        {
          bookmakerId: 411,
          bettingType: "HOME_DRAW_AWAY",
          bettingScope: "FULL_TIME",
          odds: [
            { value: "2.69", active: true, eventParticipantId: "UquWpnMH", handicap: null },
            { value: "2.25", active: true, eventParticipantId: null, handicap: null },
            { value: "4.09", active: true, eventParticipantId: "zq73Sw6j", handicap: null }
          ]
        },
        {
          bookmakerId: 411,
          bettingType: "DRAW_NO_BET",
          bettingScope: "FULL_TIME",
          odds: [
            { value: "2.08", active: true, eventParticipantId: "UquWpnMH", handicap: null },
            { value: "1.74", active: true, eventParticipantId: "zq73Sw6j", handicap: null }
          ]
        },
        {
          bookmakerId: 20,
          bettingType: "DRAW_NO_BET",
          bettingScope: "FULL_TIME",
          odds: [
            { value: "1.76", active: true, eventParticipantId: "UquWpnMH", handicap: null },
            { value: "2.03", active: true, eventParticipantId: "zq73Sw6j", handicap: null }
          ]
        }
      ]
    }
  }
};

const h = getMarketHandler("draw_no_bet_2way");
const michSnapshot = parseGraphqlOddsToSnapshot(michalovcePayload, { marketType: "draw_no_bet_2way", period: "full_time", marketName: h.displayName });
const michNorm = normalizeFlashscoreMarketSnapshot(michSnapshot, {
  marketType: "draw_no_bet_2way", marketName: h.displayName,
  expectedLabels: h.expectedLabels, labelAliases: h.labelAliases,
  requireExactLabelSet: h.requireExactLabelSet, expectedOddCount: h.expectedOddCount,
  requireLine: h.requireLine, period: "full_time"
}, "fixture://michalovce");

ok(michNorm.bookmakerRows.length === 2, "Michalovce DNB: 2 bookmaker rows parsed (Tipsport + Nike)");
const tipMich = michNorm.bookmakerRows.find(r => r.bookmaker === "Tipsport.sk");
const nikeMich = michNorm.bookmakerRows.find(r => r.bookmaker === "Nike.sk");

ok(!!tipMich, "Michalovce DNB: Tipsport row found");
ok(tipMich?.selectionOdds?.home === 2.08, "Michalovce DNB: Tipsport home (Michalovce) = 2.08");
ok(tipMich?.selectionOdds?.away === 1.74, "Michalovce DNB: Tipsport away (Spišská) = 1.74");
ok(tipMich?.selectionConfidence === "explicit", "Michalovce DNB: Tipsport selectionConfidence = explicit");
ok(tipMich?.selectionOdds?.home !== 1.74, "Michalovce DNB: Tipsport home is NOT 1.74 (anti-swap guard)");
ok(tipMich?.selectionOdds?.away !== 2.08, "Michalovce DNB: Tipsport away is NOT 2.08 (anti-swap guard)");

ok(!!nikeMich, "Michalovce DNB: Nike row found");
ok(nikeMich?.selectionOdds?.home === 1.76, "Michalovce DNB: Nike home (Michalovce) = 1.76");
ok(nikeMich?.selectionOdds?.away === 2.03, "Michalovce DNB: Nike away (Spišská) = 2.03");

// Simulate comparison: Nike away = 2.03 vs Tipsport away = 1.74. Nike > Tipsport.
const nikeAwayOdd = nikeMich?.selectionOdds?.away;
const tipsportAwayOdd = tipMich?.selectionOdds?.away;
ok(nikeAwayOdd === 2.03, "Michalovce DNB: Nike away odd is 2.03");
ok(tipsportAwayOdd === 1.74, "Michalovce DNB: Tipsport away odd is 1.74 (correct side)");
ok(isNikeGreaterThanTipsport(nikeAwayOdd, tipsportAwayOdd), "Michalovce DNB: Nike away 2.03 > Tipsport away 1.74");

// Validate candidate row for away selection.
const candidateAway = {
  marketType: "draw_no_bet_2way", period: "full_time", selection: "away", mappedSelection: "away",
  sourceSelection: "away", nikeOdd: 2.03, tipsportOdd: 1.74, line: null, sourceLine: null,
  sourceMarketName: "Draw No Bet 2-way", columnLabels: ["1", "2"], extractedOddsArray: [2.08, 1.74]
};
const validAway = validateMarketCandidate(candidateAway);
ok(validAway.ok, `Michalovce DNB: candidate away row passes validation (${validAway.reason || "ok"})`);

// Guard: simulate wrong-side scenario (away compared against home odd).
// If tipsport away was mistakenly mapped as 2.08 (home), Nike > Tipsport would be FALSE for 2.03 > 2.08.
const wrongSideOdd = tipMich?.selectionOdds?.home; // 2.08
ok(!isNikeGreaterThanTipsport(nikeAwayOdd, wrongSideOdd), "Michalovce DNB: guard — 2.03 NOT > 2.08 if wrong side used");

// ============================================================
// FIXTURE: match_winner_2way — participantId-based mapping
// ============================================================
const winnerPayload = {
  data: {
    findOddsByEventId: {
      settings: { bookmakers: [{ bookmaker: { id: 411, name: "Tipsport.sk" } }] },
      odds: [
        {
          bookmakerId: 411,
          bettingType: "HOME_DRAW_AWAY",
          bettingScope: "FULL_TIME",
          odds: [
            { value: "1.84", active: true, eventParticipantId: "PID_HOME", handicap: null },
            { value: "3.50", active: true, eventParticipantId: null, handicap: null },
            { value: "4.20", active: true, eventParticipantId: "PID_AWAY", handicap: null }
          ]
        },
        {
          bookmakerId: 411,
          bettingType: "HOME_AWAY",
          bettingScope: "FULL_TIME",
          odds: [
            { value: "1.66", active: true, eventParticipantId: "PID_HOME", handicap: null },
            { value: "2.35", active: true, eventParticipantId: "PID_AWAY", handicap: null }
          ]
        }
      ]
    }
  }
};

const wh = getMarketHandler("match_winner_2way");
const wSnap = parseGraphqlOddsToSnapshot(winnerPayload, { marketType: "match_winner_2way", period: "full_time", marketName: wh.displayName });
const wNorm = normalizeFlashscoreMarketSnapshot(wSnap, {
  marketType: "match_winner_2way", marketName: wh.displayName,
  expectedLabels: wh.expectedLabels, labelAliases: wh.labelAliases,
  requireExactLabelSet: wh.requireExactLabelSet, expectedOddCount: wh.expectedOddCount,
  requireLine: wh.requireLine, period: "full_time"
}, "fixture://winner");
const wRow = wNorm.bookmakerRows[0];
ok(!!wRow, "match_winner: row found");
ok(wRow?.selectionOdds?.home === 1.66, "match_winner: home=1.66 via participantId");
ok(wRow?.selectionOdds?.away === 2.35, "match_winner: away=2.35 via participantId");
ok(wRow?.selectionConfidence === "explicit", "match_winner: confidence=explicit");
ok(wRow?.selectionOdds?.home !== 2.35, "match_winner: home≠2.35 (anti-swap guard)");

// ============================================================
// FIXTURE: asian_handicap_2way — handicap object line parsing
// Expected: line = -3.5 (home-side canonical), home=2.33, away=1.53
// ============================================================
const asianPayload = {
  data: {
    findOddsByEventId: {
      settings: { bookmakers: [{ bookmaker: { id: 411, name: "Tipsport.sk" } }] },
      odds: [
        {
          bookmakerId: 411,
          bettingType: "HOME_DRAW_AWAY",
          bettingScope: "FULL_TIME",
          odds: [
            { value: "1.84", active: true, eventParticipantId: "PID_HOME", handicap: null },
            { value: "3.50", active: true, eventParticipantId: null, handicap: null },
            { value: "4.20", active: true, eventParticipantId: "PID_AWAY", handicap: null }
          ]
        },
        {
          bookmakerId: 411,
          bettingType: "ASIAN_HANDICAP",
          bettingScope: "FULL_TIME",
          odds: [
            { value: "1.53", active: true, eventParticipantId: "PID_AWAY", handicap: { value: "3.5", type: "GAMES" } },
            { value: "2.33", active: true, eventParticipantId: "PID_HOME", handicap: { value: "-3.5", type: "GAMES" } }
          ]
        }
      ]
    }
  }
};
const ah = getMarketHandler("asian_handicap_2way");
const aSnap = parseGraphqlOddsToSnapshot(asianPayload, { marketType: "asian_handicap_2way", period: "full_time", marketName: ah.displayName });
const aNorm = normalizeFlashscoreMarketSnapshot(aSnap, {
  marketType: "asian_handicap_2way", marketName: ah.displayName,
  expectedLabels: ah.expectedLabels, labelAliases: ah.labelAliases,
  requireExactLabelSet: ah.requireExactLabelSet, expectedOddCount: ah.expectedOddCount,
  requireLine: ah.requireLine, period: "full_time"
}, "fixture://asian");
const aRow = aNorm.bookmakerRows[0];
ok(!!aRow, "asian_handicap: row found");
ok(aRow?.line === -3.5, `asian_handicap: canonical line parsed as -3.5 (got ${aRow?.line})`);
ok(aRow?.selectionOdds?.home === 2.33, "asian_handicap: home=2.33");
ok(aRow?.selectionOdds?.away === 1.53, "asian_handicap: away=1.53");
ok(aRow?.selectionConfidence === "explicit", "asian_handicap: confidence=explicit");

// ============================================================
// FIXTURE: football asian handicap with opposite-sign pairing
// Expected canonical rows:
//  line +1.0 => home(+1)=1.07, away(-1)=9.14
//  line -1.0 => home(-1)=3.12, away(+1)=1.39
// ============================================================
const footballAsianPayload = {
  data: {
    findOddsByEventId: {
      settings: { bookmakers: [{ bookmaker: { id: 411, name: "Tipsport.sk" } }] },
      odds: [
        {
          bookmakerId: 411,
          bettingType: "HOME_DRAW_AWAY",
          bettingScope: "FULL_TIME",
          odds: [
            { value: "2.74", active: true, eventParticipantId: "PID_HOME", handicap: null },
            { value: "4.77", active: true, eventParticipantId: "PID_AWAY", handicap: null },
            { value: "2.05", active: true, eventParticipantId: null, handicap: null }
          ]
        },
        {
          bookmakerId: 411,
          bettingType: "ASIAN_HANDICAP",
          bettingScope: "FULL_TIME",
          odds: [
            { value: "1.07", active: true, eventParticipantId: "PID_HOME", handicap: { value: "1.0", type: "GOALS" } },
            { value: "1.39", active: true, eventParticipantId: "PID_AWAY", handicap: { value: "1.0", type: "GOALS" } },
            { value: "3.12", active: true, eventParticipantId: "PID_HOME", handicap: { value: "-1.0", type: "GOALS" } },
            { value: "9.14", active: true, eventParticipantId: "PID_AWAY", handicap: { value: "-1.0", type: "GOALS" } }
          ]
        }
      ]
    }
  }
};
const fSnap = parseGraphqlOddsToSnapshot(footballAsianPayload, { marketType: "asian_handicap_2way", period: "full_time", marketName: ah.displayName });
const fNorm = normalizeFlashscoreMarketSnapshot(fSnap, {
  marketType: "asian_handicap_2way", marketName: ah.displayName,
  expectedLabels: ah.expectedLabels, labelAliases: ah.labelAliases,
  requireExactLabelSet: ah.requireExactLabelSet, expectedOddCount: ah.expectedOddCount,
  requireLine: ah.requireLine, period: "full_time"
}, "fixture://football-asian");
const linePlusOne = fNorm.bookmakerRows.find(r => r.line === 1);
const lineMinusOne = fNorm.bookmakerRows.find(r => r.line === -1);
ok(!!linePlusOne, "football asian: line +1 row found");
ok(linePlusOne?.selectionOdds?.home === 1.07, "football asian: line +1 home=1.07");
ok(linePlusOne?.selectionOdds?.away === 9.14, "football asian: line +1 away=9.14 (opposite-sign paired)");
ok(!!lineMinusOne, "football asian: line -1 row found");
ok(lineMinusOne?.selectionOdds?.home === 3.12, "football asian: line -1 home=3.12");
ok(lineMinusOne?.selectionOdds?.away === 1.39, "football asian: line -1 away=1.39 (opposite-sign paired)");
// ============================================================
// FIXTURE: first_half period — must be rejected by validateMarketCandidate
// ============================================================
const firstHalfCandidate = {
  marketType: "double_chance", period: "first_half", selection: "1x", mappedSelection: "1x",
  sourceSelection: "1x", nikeOdd: 1.35, tipsportOdd: 1.30, line: null, sourceLine: null,
  sourceMarketName: "Double Chance", columnLabels: ["1X", "12", "X2"], extractedOddsArray: [1.30, 1.38, 1.75]
};
const firstHalfResult = validateMarketCandidate(firstHalfCandidate);
ok(!firstHalfResult.ok, "first_half rejected by validateMarketCandidate");
ok(firstHalfResult.reason === "period_first_or_second_half_not_supported_e2e", `first_half rejected with explicit reason (got: ${firstHalfResult.reason})`);

if (failed > 0) { console.error(`\n${failed} test(s) FAILED.`); process.exit(1); }
console.log("\nAll accuracy regression tests passed.");
