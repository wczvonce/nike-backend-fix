import { getCompareEnabledMarketTypes } from "../markets/handlers.js";

export function normalizeForCompare(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function toDateTimeSortable(match) {
  const dt = match?.kickoffAt || "";
  return dt || "9999-12-31T23:59:59";
}

export function round2(n) {
  return Number(Number(n).toFixed(2));
}

export function compareRows(a, b) {
  if (b.probabilityEdgePp !== a.probabilityEdgePp) return b.probabilityEdgePp - a.probabilityEdgePp;
  if (b.diff !== a.diff) return b.diff - a.diff;
  return toDateTimeSortable(a).localeCompare(toDateTimeSortable(b));
}

export function computeMetrics(nikeOdd, tipsportOdd) {
  const diff = nikeOdd - tipsportOdd;
  const percentDiff = (diff / tipsportOdd) * 100;
  const probabilityEdgePp = ((1 / tipsportOdd) - (1 / nikeOdd)) * 100;
  return {
    nikeOdd: round2(nikeOdd),
    tipsportOdd: round2(tipsportOdd),
    diff: round2(diff),
    percentDiff: round2(percentDiff),
    probabilityEdgePp: round2(probabilityEdgePp)
  };
}

export function isLineMarket(marketType) {
  return ["asian_handicap_2way", "over_under_2way", "european_handicap_2way"].includes(marketType);
}

export function isHomeAwayMarket(marketType) {
  return ["match_winner_2way", "asian_handicap_2way", "draw_no_bet_2way", "european_handicap_2way"].includes(marketType);
}

export function mapSelectionForSwap(selection, swapped) {
  if (!swapped) return selection;
  if (selection === "1x") return "x2";
  if (selection === "x2") return "1x";
  if (selection === "home") return "away";
  if (selection === "away") return "home";
  return selection;
}

export function mapLineForSwap(line, marketType, swapped) {
  if (!swapped || line == null) return line;
  if (["asian_handicap_2way", "european_handicap_2way"].includes(marketType)) {
    return round2(-Number(line));
  }
  return line;
}

export function sameLine(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < 0.001;
}

export const ALLOWED_MARKET_TYPES = new Set([
  "double_chance",
  "match_winner_2way",
  "over_under_2way",
  "asian_handicap_2way",
  "both_teams_to_score",
  "draw_no_bet_2way",
  "team_to_score_yes_no",
  "european_handicap_2way",
  "generic_yes_no"
]);

export const E2E_COMPARE_MARKET_TYPES = getCompareEnabledMarketTypes();

export function isNikeGreaterThanTipsport(nikeOdd, tipsportOdd) {
  return Number(nikeOdd) > Number(tipsportOdd);
}

export function validateMarketCandidate(row) {
  if (!ALLOWED_MARKET_TYPES.has(row.marketType)) return { ok: false, reason: "market_type_not_allowed" };
  if (row.nikeOdd == null || row.tipsportOdd == null) return { ok: false, reason: "missing_odds" };
  if (!(row.nikeOdd > 1 && row.tipsportOdd > 1)) return { ok: false, reason: "invalid_odds_range" };
  const allowedPeriods = new Set(["full_time", "first_set", "second_set"]);
  // first_half / second_half are recognized in Nike parser but not wired for Flashscore comparison.
  // Explicitly reject them here with a clear reason instead of silently mismatching.
  if (["first_half", "second_half"].includes(row.period)) {
    return { ok: false, reason: "period_first_or_second_half_not_supported_e2e" };
  }
  if (!allowedPeriods.has(row.period)) return { ok: false, reason: "period_mismatch" };
  const sourcePeriod = row.sourcePeriod || row.period;
  if (sourcePeriod !== row.period) return { ok: false, reason: "period_mismatch" };

  if (row.marketType === "double_chance" && !["1x", "12", "x2"].includes(row.selection)) return { ok: false, reason: "selection_mismatch" };
  if (row.marketType === "double_chance" && !(row.nikeOdd >= 1.05 && row.nikeOdd <= 4.5 && row.tipsportOdd >= 1.05 && row.tipsportOdd <= 4.5)) {
    return { ok: false, reason: "double_chance_odds_out_of_range" };
  }
  if (row.marketType === "double_chance") {
    const marketName = normalizeForCompare(row.sourceMarketName || "");
    if (!(marketName.includes("dvojita") || marketName.includes("double chance"))) {
      return { ok: false, reason: "double_chance_market_name_mismatch" };
    }
    const labels = (row.columnLabels || []).map((x) => normalizeForCompare(x));
    const exactDcLabels = labels.length === 3 && labels[0] === "1x" && labels[1] === "12" && labels[2] === "x2";
    if (!exactDcLabels) return { ok: false, reason: "double_chance_column_label_mismatch" };
    if (!Array.isArray(row.extractedOddsArray) || row.extractedOddsArray.length !== 3) {
      return { ok: false, reason: "double_chance_row_parse_mismatch" };
    }
  }

  if (row.marketType === "match_winner_2way" && !["home", "away"].includes(row.selection)) return { ok: false, reason: "selection_mismatch" };
  if (row.marketType === "match_winner_2way") {
    const marketName = normalizeForCompare(row.sourceMarketName || "");
    if (!(marketName.includes("vitaz") || marketName.includes("winner"))) {
      return { ok: false, reason: "winner_2way_market_name_mismatch" };
    }
    const labels = (row.columnLabels || []).map((x) => normalizeForCompare(x));
    const exactWinnerLabels = labels.length === 2 && labels[0] === "1" && labels[1] === "2";
    if (!exactWinnerLabels) return { ok: false, reason: "winner_2way_column_label_mismatch" };
    if (!Array.isArray(row.extractedOddsArray) || row.extractedOddsArray.length !== 2) {
      return { ok: false, reason: "winner_2way_row_parse_mismatch" };
    }
  }

  if (["over_under_2way"].includes(row.marketType) && !["over", "under"].includes(row.selection)) return { ok: false, reason: "selection_mismatch" };
  if (["both_teams_to_score", "team_to_score_yes_no", "generic_yes_no"].includes(row.marketType) && !["yes", "no"].includes(row.selection)) return { ok: false, reason: "selection_mismatch" };
  if (["asian_handicap_2way", "draw_no_bet_2way", "european_handicap_2way"].includes(row.marketType) && !["home", "away"].includes(row.selection)) {
    return { ok: false, reason: "selection_mismatch" };
  }
  if (isLineMarket(row.marketType) && row.line == null) return { ok: false, reason: "line_missing" };
  if (isLineMarket(row.marketType) && row.sourceLine == null) return { ok: false, reason: "line_missing_source" };
  if (isLineMarket(row.marketType) && !sameLine(row.line, row.sourceLine)) return { ok: false, reason: "line_mismatch" };
  if (row.sourceSelection && row.sourceSelection !== row.mappedSelection && row.sourceSelection !== row.selection) {
    return { ok: false, reason: "selection_source_mismatch" };
  }

  return { ok: true };
}

export function compute2WayMarginPercent(odd1, odd2) {
  if (!(odd1 > 1) || !(odd2 > 1)) return null;
  return round2(((1 / odd1) + (1 / odd2) - 1) * 100);
}

export function compute3WayMarginPercent(odd1, odd2, odd3) {
  if (!(odd1 > 1) || !(odd2 > 1) || !(odd3 > 1)) return null;
  // Standard overround: (sum of 1/odd_i - 1) * 100
  return round2(((1 / odd1) + (1 / odd2) + (1 / odd3) - 1) * 100);
}

export function getPairSelectionsForMarket(marketType) {
  if (["match_winner_2way", "draw_no_bet_2way", "asian_handicap_2way", "european_handicap_2way"].includes(marketType)) {
    return { type: "home_away", keys: ["home", "away"] };
  }
  if (marketType === "over_under_2way") {
    return { type: "over_under", keys: ["over", "under"] };
  }
  if (["both_teams_to_score", "team_to_score_yes_no", "generic_yes_no"].includes(marketType)) {
    return { type: "yes_no", keys: ["yes", "no"] };
  }
  if (marketType === "double_chance") {
    return { type: "double_chance_3way", keys: ["1x", "12", "x2"] };
  }
  return null;
}

export function validateFinalRows(rows) {
  const errors = [];
  for (const row of rows) {
    if (!(row.nikeOdd > row.tipsportOdd)) errors.push(`nike_not_gt_tipsport:${row.match}:${row.selection}`);
    if (![row.diff, row.percentDiff, row.probabilityEdgePp].every((x) => Number.isFinite(x))) {
      errors.push(`invalid_calculation:${row.match}:${row.selection}`);
    }
  }
  const sortedCopy = [...rows].sort(compareRows);
  const sortedOk = JSON.stringify(rows) === JSON.stringify(sortedCopy);
  if (!sortedOk) errors.push("rows_not_sorted");
  return { ok: errors.length === 0, errors };
}

