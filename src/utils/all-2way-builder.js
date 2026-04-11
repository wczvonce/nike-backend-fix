import {
  ALLOWED_MARKET_TYPES,
  compute2WayMarginPercent,
  compute3WayMarginPercent,
  getPairSelectionsForMarket,
  round2
} from "./pipeline-logic.js";

/**
 * Builds the flat "All 2-Way Opportunities" row list from a completed pipeline result.
 *
 * Source: pipeline.rows (validated final edges where Nike > Tipsport)
 *       + pipeline.controlRows with status MATCHED or nike_not_gt_tipsport
 *         (both sides of a valid pair, even if Nike is not greater)
 *
 * NEVER uses rejected/incomplete/stale rows.
 */
export function build2WayOpportunities(pipeline) {
  const matchById = new Map(pipeline.nike.matches.map((m) => [m.id, m]));

  // Source: only rows that passed full validation (MATCHED or nike_not_gt_tipsport).
  // These have verified same-event, same-market, same-period, same-line, same-selection.
  // Both Nike and Tipsport odds are present and valid.
  const safeRows = (pipeline.controlRows || []).filter((r) => {
    if (!ALLOWED_MARKET_TYPES.has(r.marketType)) return false;
    if (r.nikeOdd == null || r.tipsportOdd == null) return false;
    if (r.status === "MATCHED") return true;
    if (r.status === "REJECTED_BY_VALIDATOR" && r.compareReason === "nike_not_gt_tipsport") return true;
    return false;
  });

  // Group by matchId | marketType | line | period
  const groups = new Map();
  for (const row of safeRows) {
    const lineKey = row.line == null ? "__null__" : String(row.line);
    const key = `${row.matchId}|${row.marketType}|${lineKey}|${row.period || "full_time"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const result = [];

  for (const groupRows of groups.values()) {
    const firstRow = groupRows[0];
    const pairInfo = getPairSelectionsForMarket(firstRow.marketType);
    const matchMeta = matchById.get(firstRow.matchId) || {};

    // One representative row per selection (first occurrence wins)
    const bySelection = new Map();
    for (const r of groupRows) {
      if (r.selection != null && !bySelection.has(r.selection)) {
        bySelection.set(r.selection, r);
      }
    }

    let nikeMarginPercent = null;
    let tipsportMarginPercent = null;
    let marginNote = null;

    if (!pairInfo) {
      marginNote = "unsupported_market_type";
    } else if (pairInfo.type === "double_chance_3way") {
      marginNote = "margin_not_applicable_double_chance_3way";
    } else {
      const [key1, key2] = pairInfo.keys;
      const r1 = bySelection.get(key1);
      const r2 = bySelection.get(key2);

      if (r1?.nikeOdd > 1 && r2?.nikeOdd > 1) {
        nikeMarginPercent = compute2WayMarginPercent(r1.nikeOdd, r2.nikeOdd);
      } else {
        marginNote = "incomplete_pair";
      }

      if (r1?.tipsportOdd > 1 && r2?.tipsportOdd > 1) {
        tipsportMarginPercent = compute2WayMarginPercent(r1.tipsportOdd, r2.tipsportOdd);
      }
    }

    const marginDiff =
      nikeMarginPercent != null && tipsportMarginPercent != null
        ? round2(nikeMarginPercent - tipsportMarginPercent)
        : null;

    for (const row of groupRows) {
      result.push({
        matchId: row.matchId,
        match: row.match,
        kickoffAt: row.kickoffAt || null,
        sport: row.sport,
        tournament: matchMeta.tournament || null,
        marketType: row.marketType,
        rawMarketName: row.rawMarketName || row.marketType,
        selection: row.selection,
        period: row.period || "full_time",
        line: row.line ?? null,
        nikeOdd: row.nikeOdd ?? null,
        tipsportOdd: row.tipsportOdd ?? null,
        tipsportOddTrend: row.tipsportOddTrend ?? null,
        nikeMarginPercent,
        tipsportMarginPercent,
        marginDiff,
        marginNote,
        status: row.status,
        compareReason: row.compareReason || null,
        sourceType: row.sourceType || null
      });
    }
  }

  result.sort((a, b) => {
    if (a.nikeMarginPercent == null && b.nikeMarginPercent == null) return 0;
    if (a.nikeMarginPercent == null) return 1;
    if (b.nikeMarginPercent == null) return -1;
    if (a.nikeMarginPercent !== b.nikeMarginPercent) return a.nikeMarginPercent - b.nikeMarginPercent;
    return (a.match || "").localeCompare(b.match || "");
  });

  return result;
}
