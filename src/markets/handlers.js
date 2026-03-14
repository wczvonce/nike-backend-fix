export const MARKET_HANDLER_DEFINITIONS = {
  double_chance: {
    marketType: "double_chance",
    displayName: "Double Chance",
    tabRegex: /DVOJITÁ ŠANCA|DOUBLE CHANCE/i,
    expectedLabels: ["1x", "12", "x2"],
    labelAliases: { "1x": "1x", "12": "12", "x2": "x2" },
    requireExactLabelSet: true,
    expectedOddCount: 3,
    requireLine: false,
    selectionKeys: ["1x", "12", "x2"],
    minOdd: 1.05,
    maxOdd: 4.5,
    compareEnabled: true
  },
  match_winner_2way: {
    marketType: "match_winner_2way",
    displayName: "Match Winner 2-way",
    tabRegex: /VÍŤAZ ZÁPASU|MATCH WINNER|1X2/i,
    expectedLabels: ["1", "2"],
    labelAliases: { "1": "1", "2": "2", home: "1", away: "2" },
    requireExactLabelSet: true,
    expectedOddCount: 2,
    requireLine: false,
    selectionKeys: ["home", "away"],
    minOdd: 1.01,
    maxOdd: 20,
    compareEnabled: true
  },
  over_under_2way: {
    marketType: "over_under_2way",
    displayName: "Over/Under 2-way",
    tabRegex: /OVER\/UNDER|OVER UNDER/i,
    expectedLabels: ["celkom", "over", "under"],
    labelAliases: {
      celkom: "celkom",
      sety: "celkom",
      gemy: "celkom",
      over: "over",
      under: "under"
    },
    requireExactLabelSet: false,
    expectedOddCount: 2,
    requireLine: true,
    selectionKeys: ["over", "under"],
    minOdd: 1.01,
    maxOdd: 20,
    compareEnabled: true
  },
  asian_handicap_2way: {
    marketType: "asian_handicap_2way",
    displayName: "Asian Handicap 2-way",
    tabRegex: /ÁZIJSKÝ HANDICAP|AZIJSK[YÝ] HANDICAP|ASIAN HANDICAP/i,
    expectedLabels: ["handicap", "1", "2"],
    labelAliases: {
      handicap: "handicap",
      sety: "handicap",
      gemy: "handicap",
      "1": "1",
      "2": "2",
      home: "1",
      away: "2"
    },
    requireExactLabelSet: false,
    expectedOddCount: 2,
    requireLine: true,
    selectionKeys: ["home", "away"],
    minOdd: 1.01,
    maxOdd: 20,
    compareEnabled: true
  },
  both_teams_to_score: {
    marketType: "both_teams_to_score",
    displayName: "Both Teams To Score",
    tabRegex: /OBAJA DAJ[ÚU] G[ÓO]L|BOTH TEAMS TO SCORE/i,
    expectedLabels: ["yes", "no"],
    labelAliases: { ano: "yes", áno: "yes", yes: "yes", nie: "no", no: "no" },
    requireExactLabelSet: true,
    expectedOddCount: 2,
    requireLine: false,
    selectionKeys: ["yes", "no"],
    minOdd: 1.01,
    maxOdd: 20,
    compareEnabled: true
  },
  draw_no_bet_2way: {
    marketType: "draw_no_bet_2way",
    displayName: "Draw No Bet 2-way",
    tabRegex: /ST[ÁA]VKA BEZ REM[ÍI]ZY|DRAW NO BET/i,
    expectedLabels: ["1", "2"],
    labelAliases: { "1": "1", "2": "2", home: "1", away: "2" },
    requireExactLabelSet: true,
    expectedOddCount: 2,
    requireLine: false,
    selectionKeys: ["home", "away"],
    minOdd: 1.01,
    maxOdd: 20,
    compareEnabled: true
  },
  team_to_score_yes_no: {
    marketType: "team_to_score_yes_no",
    displayName: "Team To Score Yes/No",
    tabRegex: /T[IÍ]M D[AÁ] G[ÓO]L|TEAM TO SCORE/i,
    expectedLabels: ["yes", "no"],
    labelAliases: { ano: "yes", áno: "yes", yes: "yes", nie: "no", no: "no" },
    requireExactLabelSet: true,
    expectedOddCount: 2,
    requireLine: false,
    selectionKeys: ["yes", "no"],
    minOdd: 1.01,
    maxOdd: 20,
    compareEnabled: false
  },
  generic_yes_no: {
    marketType: "generic_yes_no",
    displayName: "Generic Yes/No",
    tabRegex: /YES|NO|ÁNO|NIE/i,
    expectedLabels: ["yes", "no"],
    labelAliases: { ano: "yes", áno: "yes", yes: "yes", nie: "no", no: "no" },
    requireExactLabelSet: true,
    expectedOddCount: 2,
    requireLine: false,
    selectionKeys: ["yes", "no"],
    minOdd: 1.01,
    maxOdd: 20,
    compareEnabled: false
  },
  european_handicap_2way: {
    marketType: "european_handicap_2way",
    displayName: "European Handicap 2-way",
    tabRegex: /EUR[ÓO]PSKY HANDICAP|EUROPEAN HANDICAP/i,
    expectedLabels: ["handicap", "1", "2"],
    labelAliases: { handicap: "handicap", "1": "1", "2": "2", home: "1", away: "2" },
    requireExactLabelSet: true,
    expectedOddCount: 2,
    requireLine: true,
    selectionKeys: ["home", "away"],
    minOdd: 1.01,
    maxOdd: 20,
    compareEnabled: false
  }
};

export function getMarketHandler(marketType) {
  return MARKET_HANDLER_DEFINITIONS[marketType] || null;
}

export function getAllMarketHandlers() {
  return Object.values(MARKET_HANDLER_DEFINITIONS);
}

export function getCompareEnabledMarketTypes() {
  return new Set(getAllMarketHandlers().filter((h) => h.compareEnabled).map((h) => h.marketType));
}

