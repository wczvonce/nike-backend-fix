import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrapeNikeSuperkurzy, debugNikeSuperkurzy } from "./scrapers/nike.js";
import { createFlashscoreSession, searchFlashscoreMatch, scrapeFlashscoreDoubleChance, scrapeFlashscoreMarketByType } from "./scrapers/flashscore.js";
import { EXPECTED_SUPERPONUKA_SNAPSHOT, EXPECTED_SUPERPONUKA_SPORT_BY_TITLE } from "./config/superponuka.js";
import { createNormalizedMarket } from "./markets/market-model.js";
import { getAllMarketHandlers, getMarketHandler } from "./markets/handlers.js";
import {
  normalizeForCompare,
  compareRows,
  validateMarketCandidate,
  validateFinalRows,
  isLineMarket,
  isHomeAwayMarket,
  mapSelectionForSwap,
  mapLineForSwap,
  sameLine,
  computeMetrics,
  E2E_COMPARE_MARKET_TYPES,
  isNikeGreaterThanTipsport
} from "./utils/pipeline-logic.js";
import { build2WayOpportunities } from "./utils/all-2way-builder.js";

dotenv.config();
const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json({ limit: "2mb" }));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "..", "public")));
const PORT = Number(process.env.PORT || 3001);
const HEADLESS = String(process.env.HEADLESS || "true") !== "false";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 45000);
const STRICT_EXPECTED_SUPERPONUKA = String(process.env.STRICT_EXPECTED_SUPERPONUKA || "false") === "true";
const FLASHSCORE_ENABLE_NETWORK_FIRST = String(process.env.FLASHSCORE_ENABLE_NETWORK_FIRST || "true") !== "false";
const FLASHSCORE_ENABLE_DOM_FALLBACK = String(process.env.FLASHSCORE_ENABLE_DOM_FALLBACK || "true") !== "false";
const FLASHSCORE_FAIL_IF_FALLBACK_RATE_ABOVE = (() => {
  const raw = process.env.FLASHSCORE_FAIL_IF_FALLBACK_RATE_ABOVE;
  if (raw == null || String(raw).trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
})();
const UI_CACHE_MS = Number(process.env.UI_CACHE_MS || 10000);
let uiPipelineCache = { pipeline: null, cachedAtMs: 0 };
let uiPipelineInFlight = null;

function validateSuperponuka(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return { ok: false, error: "Nike parser mismatch: no matches parsed" };
  const got = matches.map((m) => normalizeForCompare(m.rawTitle));
  if (new Set(got).size !== got.length) return { ok: false, error: "Nike parser mismatch: duplicate matches found" };
  for (const m of matches) {
    const key = normalizeForCompare(m.rawTitle);
    if (!m.sport || m.sport === "unknown") continue; // skip unknown sports, don't fail entire pipeline
    const expectedSport = EXPECTED_SUPERPONUKA_SPORT_BY_TITLE[key];
    if (STRICT_EXPECTED_SUPERPONUKA && expectedSport && m.sport !== expectedSport) {
      return { ok: false, error: `Nike parser mismatch: wrong sport for "${m.rawTitle}"` };
    }
  }
  if (STRICT_EXPECTED_SUPERPONUKA) {
    if (matches.length !== EXPECTED_SUPERPONUKA_SNAPSHOT.length) {
      return { ok: false, error: `Nike parser mismatch: expected ${EXPECTED_SUPERPONUKA_SNAPSHOT.length} matches, got ${matches.length}` };
    }
    const expected = EXPECTED_SUPERPONUKA_SNAPSHOT.map((m) => normalizeForCompare(m));
    for (const name of expected) {
      if (!got.includes(name)) return { ok: false, error: `Nike parser mismatch: missing match "${name}"` };
    }
  }
  return { ok: true };
}

function similarity(a, b) {
  const x = normalizeForCompare(a);
  const y = normalizeForCompare(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const xTokens = new Set(x.split(" ").filter(Boolean));
  const yTokens = new Set(y.split(" ").filter(Boolean));
  const inter = [...xTokens].filter((t) => yTokens.has(t)).length;
  if (!inter) return 0;
  return inter / Math.max(xTokens.size, yTokens.size);
}

function isSwappedOrientation(nikeMatch, fsMatch) {
  const straight = similarity(nikeMatch.homeTeam, fsMatch.homeTeam) + similarity(nikeMatch.awayTeam, fsMatch.awayTeam);
  const swapped = similarity(nikeMatch.homeTeam, fsMatch.awayTeam) + similarity(nikeMatch.awayTeam, fsMatch.homeTeam);
  return swapped > straight + 0.05;
}


function validateFlashscoreMappings(matchMappings, expectedCount = null) {
  const errors = [];
  if (!Array.isArray(matchMappings)) {
    errors.push("missing mappings array");
  } else if (Number.isInteger(expectedCount) && expectedCount >= 0 && matchMappings.length !== expectedCount) {
    errors.push(`expected ${expectedCount} mappings, got ${matchMappings.length}`);
  }
  const unmatched = (matchMappings || []).filter((m) => !m.matched);
  if (unmatched.length) errors.push(`unmatched nike events: ${unmatched.map((m) => m.nikeMatch).join(", ")}`);
  const lowConfidence = (matchMappings || []).filter((m) => m.matched && Number(m.confidence || 0) < 140);
  if (lowConfidence.length) errors.push(`low confidence mappings: ${lowConfidence.map((m) => m.nikeMatch).join(", ")}`);
  const hrefs = (matchMappings || []).filter((m) => m.matched).map((m) => m.flashscoreHref);
  if (new Set(hrefs).size !== hrefs.length) errors.push("duplicate flashscore href mapping");
  return { ok: errors.length === 0, errors };
}

async function getUiPipeline({ force = false } = {}) {
  const now = Date.now();
  const cacheValid = uiPipelineCache.pipeline && (now - uiPipelineCache.cachedAtMs) < UI_CACHE_MS;
  if (!force && cacheValid) return uiPipelineCache.pipeline;
  if (uiPipelineInFlight) return uiPipelineInFlight;
  uiPipelineInFlight = (async () => {
    const pipeline = await buildNikeTipsportPipeline();
    if (pipeline?.ok) {
      uiPipelineCache = { pipeline, cachedAtMs: Date.now() };
    }
    return pipeline;
  })();
  try {
    return await uiPipelineInFlight;
  } finally {
    uiPipelineInFlight = null;
  }
}

function selectionKeysForMarket(marketType) {
  const handler = getMarketHandler(marketType);
  if (Array.isArray(handler?.selectionKeys) && handler.selectionKeys.length) {
    return handler.selectionKeys;
  }
  return [];
}


async function buildNikeTipsportPipeline() {
  const flashscoreSession = await createFlashscoreSession({ headless: HEADLESS, timeoutMs: REQUEST_TIMEOUT_MS });
  const runStartedAtMs = Date.now();
  const perMatchTimings = [];
  try {
  const nike = await scrapeNikeSuperkurzy({ headless: HEADLESS, timeoutMs: REQUEST_TIMEOUT_MS });
  // Only process Superkurzy (super_ponuka) matches — NOT Superšanca (super_sanca).
  // Superšanca has many low-value matches that slow down the pipeline and aren't the target.
  const superkurzyMatches = nike.matches.filter((m) => m.section === "super_ponuka");
  const superkurzyMarketIds = new Set(superkurzyMatches.map((m) => m.id));
  nike.markets = nike.markets.filter((m) => superkurzyMarketIds.has(m.matchId));
  nike.matches = superkurzyMatches;

  const nikeValidation = validateSuperponuka(nike.matches);
  if (!nikeValidation.ok) {
    return { ok: false, error: nikeValidation.error, stage: "nike_validation" };
  }

  const comparedRows = [];
  const rejectedRows = [];
  const controlRows = [];
  const matchMappings = [];

  for (const match of nike.matches) {
    const matchStartedAt = Date.now();
    const fsMatch = await searchFlashscoreMatch({
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      sport: match.sport,
      tournament: match.tournament || "",
      kickoffAt: match.kickoffAt || null,
      headless: HEADLESS,
      timeoutMs: REQUEST_TIMEOUT_MS
    });

    if (!fsMatch?.href) {
      matchMappings.push({ nikeMatch: match.rawTitle, matched: false, reason: "flashscore_not_found" });
      const nikeMarketsForUnmatched = nike.markets.filter((m) => m.matchId === match.id);
      for (const m of nikeMarketsForUnmatched) {
        controlRows.push({
          matchId: match.id,
          match: match.rawTitle,
          kickoffAt: match.kickoffAt || null,
          sport: match.sport,
          marketType: m.marketType,
          rawMarketName: m.marketType,
          selection: m.selection,
          period: m.period || "full_time",
          line: m.line ?? null,
          nikeOdd: m.nikeOdd,
          tipsportOdd: null,
          tipsportOddTrend: null,
          status: "NIKE_ONLY",
          compareReason: "flashscore_match_not_found"
        });
      }
      continue;
    }
    const swapped = isSwappedOrientation(match, fsMatch);
    const straightSim = similarity(match.homeTeam, fsMatch.homeTeam) + similarity(match.awayTeam, fsMatch.awayTeam);
    const swappedSim = similarity(match.homeTeam, fsMatch.awayTeam) + similarity(match.awayTeam, fsMatch.homeTeam);
    matchMappings.push({
      nikeMatch: match.rawTitle,
      matched: true,
      flashscoreHref: fsMatch.href,
      confidence: fsMatch.confidence,
      orientationSwapped: swapped,
      straightSimilarity: Number(straightSim.toFixed(3)),
      swappedSimilarity: Number(swappedSim.toFixed(3)),
      flashscoreHomeTeam: fsMatch.homeTeam,
      flashscoreAwayTeam: fsMatch.awayTeam
    });

    const nikeMarketsForMatch = nike.markets.filter((m) => m.matchId === match.id);
    const marketTypes = [...new Set(nikeMarketsForMatch.map((m) => m.marketType))];

    for (const marketType of marketTypes) {
      if (!E2E_COMPARE_MARKET_TYPES.has(marketType)) {
        const disabledMarkets = nikeMarketsForMatch.filter((m) => m.marketType === marketType);
        for (const m of disabledMarkets) {
          controlRows.push({
            matchId: match.id,
            match: match.rawTitle,
            kickoffAt: match.kickoffAt || null,
            sport: match.sport,
            marketType,
            rawMarketName: marketType,
            selection: m.selection,
            period: m.period || "full_time",
            line: m.line ?? null,
            nikeOdd: m.nikeOdd,
            tipsportOdd: null,
            tipsportOddTrend: null,
            status: "DISABLED",
            compareReason: "market_not_enabled_end_to_end"
          });
          rejectedRows.push({
            matchId: match.id,
            match: match.rawTitle,
            marketType,
            selection: m.selection,
            line: m.line ?? null,
            nikeOdd: m.nikeOdd,
            rejectReason: "market_not_enabled_end_to_end"
          });
        }
        continue;
      }
      const nikeMarketRows = nikeMarketsForMatch.filter((m) => m.marketType === marketType);
      const periods = [...new Set(nikeMarketRows.map((m) => m.period || "full_time"))];

      for (const period of periods) {
        const fsMarket = marketType === "double_chance"
          ? await scrapeFlashscoreDoubleChance({
            matchUrl: fsMatch.href,
            period,
            session: flashscoreSession,
            enableNetworkFirst: FLASHSCORE_ENABLE_NETWORK_FIRST,
            enableDomFallback: FLASHSCORE_ENABLE_DOM_FALLBACK,
            headless: HEADLESS,
            timeoutMs: REQUEST_TIMEOUT_MS
          })
          : await scrapeFlashscoreMarketByType({
            matchUrl: fsMatch.href,
            marketType,
            period,
            session: flashscoreSession,
            enableNetworkFirst: FLASHSCORE_ENABLE_NETWORK_FIRST,
            enableDomFallback: FLASHSCORE_ENABLE_DOM_FALLBACK,
            headless: HEADLESS,
            timeoutMs: REQUEST_TIMEOUT_MS
          });
        const tipsportRows = fsMarket.bookmakerRows.filter((b) => normalizeForCompare(b.bookmaker).includes("tipsport"));
        const nikeRowsForPeriod = nikeMarketRows.filter((m) => (m.period || "full_time") === period);

        if (!tipsportRows.length) {
          for (const m of nikeRowsForPeriod) {
            controlRows.push({
              matchId: match.id,
              match: match.rawTitle,
              kickoffAt: match.kickoffAt || null,
              sport: match.sport,
              marketType,
              rawMarketName: fsMarket.marketName || marketType,
              selection: m.selection,
              period: m.period || "full_time",
              line: m.line ?? null,
              nikeOdd: m.nikeOdd,
              tipsportOdd: null,
              tipsportOddTrend: null,
              status: "NO_TIPSPORT_ROW",
              compareReason: "tipsport_row_not_found_for_market_period",
              sourceType: fsMarket.sourceType || "unknown",
              fallbackReason: fsMarket.fallbackReason || null
            });
          }
        }

        // Use participantDomOrder (from the actual odds page) for swap detection
        // for ALL team-relative markets (DC + home/away). The search-level
        // isSwappedOrientation can disagree with the actual page ordering.
        let marketSwapped = swapped;
        if (fsMarket.participantDomOrder?.length >= 2) {
          const domStraight = similarity(match.homeTeam, fsMarket.participantDomOrder[0])
            + similarity(match.awayTeam, fsMarket.participantDomOrder[1]);
          const domSwappedSim = similarity(match.homeTeam, fsMarket.participantDomOrder[1])
            + similarity(match.awayTeam, fsMarket.participantDomOrder[0]);
          marketSwapped = domSwappedSim > domStraight + 0.05;
        }

        for (const nikeMarket of nikeRowsForPeriod) {
        let mappedSelection = nikeMarket.selection;
        if (marketType === "double_chance") mappedSelection = mapSelectionForSwap(nikeMarket.selection, marketSwapped);
        else if (isHomeAwayMarket(marketType)) mappedSelection = mapSelectionForSwap(nikeMarket.selection, marketSwapped);
        const mappedLine = mapLineForSwap(nikeMarket.line ?? null, marketType, marketSwapped);
        const tipsportRow = isLineMarket(marketType)
          ? tipsportRows.find((row) => sameLine(row.line, mappedLine))
          : tipsportRows[0];
        const tipsportOdd = tipsportRow?.selectionOdds?.[mappedSelection] ?? null;
        const tipsportOddTrend = tipsportRow?.selectionTrend?.[mappedSelection] ?? null;
        const row = {
          matchId: match.id,
          match: match.rawTitle,
          sport: match.sport,
          tournament: match.tournament,
          kickoffAt: match.kickoffAt || null,
          marketType,
          period: nikeMarket.period || "full_time",
          line: nikeMarket.line ?? null,
          sourceLine: tipsportRow?.line ?? null,
          selection: nikeMarket.selection,
          mappedSelection,
          nikeOdd: nikeMarket.nikeOdd,
          tipsportOdd,
          tipsportOddTrend,
          flashscoreMatchUrl: fsMatch.href,
          sourceMarketName: fsMarket.marketName || null,
          sourcePeriod: fsMarket.period || period,
          sourcePeriodName: fsMarket.periodName || null,
          sourceType: fsMarket.sourceType || "unknown",
          fallbackReason: fsMarket.fallbackReason || null,
          sourceFailureReason: fsMarket.failureReason || null,
          attemptedSources: fsMarket.attemptedSources || [],
          participantRoles: fsMarket.participantRoles || null,
          participantDomOrder: fsMarket.participantDomOrder || [],
          selectionConfidence: tipsportRow?.selectionConfidence || "derived",
          swapped: marketSwapped,
          straightSimilarity: Number(straightSim.toFixed(3)),
          swappedSimilarity: Number(swappedSim.toFixed(3)),
          columnLabels: fsMarket.columnLabels || [],
          rawBookmakerRowText: tipsportRow?.rawRowText || "",
          extractedOddsArray: tipsportRow?.extractedOddsArray || [],
          // sourceSelection = confirmed key from Tipsport selectionOdds, or null if not found.
          // This must NOT be self-assigned from mappedSelection — validation compares these.
          sourceSelection: (tipsportRow?.selectionOdds && mappedSelection in tipsportRow.selectionOdds) ? mappedSelection : null
        };
        row.normalizedNikeMarket = createNormalizedMarket({
          matchId: match.id,
          marketType,
          period: nikeMarket.period || "full_time",
          line: nikeMarket.line ?? null,
          selection: nikeMarket.selection,
          side: isHomeAwayMarket(marketType) ? nikeMarket.selection : null,
          bookmaker: "Nike",
          odd: nikeMarket.nikeOdd,
          rawMarketName: marketType,
          rawSelectionName: nikeMarket.selection,
          source: "nike",
          metadata: { matchTitle: match.rawTitle }
        });
        row.normalizedTipsportMarket = createNormalizedMarket({
          matchId: match.id,
          marketType,
          period: nikeMarket.period || "full_time",
          line: tipsportRow?.line ?? null,
          selection: mappedSelection,
          side: isHomeAwayMarket(marketType) ? mappedSelection : null,
          bookmaker: tipsportRow?.bookmaker || "Tipsport",
          odd: tipsportOdd,
          rawMarketName: fsMarket.marketName || null,
          rawSelectionName: mappedSelection,
          source: "flashscore_tipsport",
          metadata: {
            rawBookmakerRowText: tipsportRow?.rawRowText || "",
            extractedOddsArray: tipsportRow?.extractedOddsArray || []
          }
        });
        const marketValidation = validateMarketCandidate(row);
        if (!marketValidation.ok) {
          const statusByReason = {
            line_mismatch: "LINE_MISMATCH",
            period_mismatch: "PERIOD_MISMATCH",
            selection_mismatch: "SELECTION_MISMATCH"
          };
          controlRows.push({
            matchId: match.id,
            match: match.rawTitle,
            kickoffAt: match.kickoffAt || null,
            sport: match.sport,
            marketType,
            rawMarketName: fsMarket.marketName || marketType,
            selection: nikeMarket.selection,
            period: nikeMarket.period || "full_time",
            line: nikeMarket.line ?? null,
            nikeOdd: nikeMarket.nikeOdd,
            tipsportOdd,
            tipsportOddTrend: row.tipsportOddTrend,
            status: statusByReason[marketValidation.reason] || "REJECTED_BY_VALIDATOR",
            compareReason: marketValidation.reason,
            sourceType: fsMarket.sourceType || "unknown",
            fallbackReason: fsMarket.fallbackReason || null
          });
          rejectedRows.push({ ...row, rejectReason: marketValidation.reason });
          continue;
        }
        if (!isNikeGreaterThanTipsport(row.nikeOdd, row.tipsportOdd)) {
          controlRows.push({
            matchId: match.id,
            match: match.rawTitle,
            kickoffAt: match.kickoffAt || null,
            sport: match.sport,
            marketType,
            rawMarketName: fsMarket.marketName || marketType,
            selection: nikeMarket.selection,
            period: nikeMarket.period || "full_time",
            line: nikeMarket.line ?? null,
            nikeOdd: nikeMarket.nikeOdd,
            tipsportOdd,
            tipsportOddTrend: row.tipsportOddTrend,
            status: "REJECTED_BY_VALIDATOR",
            compareReason: "nike_not_gt_tipsport",
            sourceType: fsMarket.sourceType || "unknown",
            fallbackReason: fsMarket.fallbackReason || null
          });
          rejectedRows.push({ ...row, rejectReason: "nike_not_gt_tipsport" });
          continue;
        }
        const metrics = computeMetrics(row.nikeOdd, row.tipsportOdd);
        // Sanity check: edges > 15pp are almost certainly parser bugs (inverted home/away,
        // wrong line match, etc.). Real Nike vs Tipsport differences are typically 0.5-5pp.
        if (metrics.probabilityEdgePp > 15) {
          controlRows.push({
            matchId: match.id,
            match: match.rawTitle,
            kickoffAt: match.kickoffAt || null,
            sport: match.sport,
            marketType,
            rawMarketName: fsMarket.marketName || marketType,
            selection: nikeMarket.selection,
            period: nikeMarket.period || "full_time",
            line: nikeMarket.line ?? null,
            nikeOdd: nikeMarket.nikeOdd,
            tipsportOdd,
            tipsportOddTrend: row.tipsportOddTrend,
            status: "REJECTED_BY_VALIDATOR",
            compareReason: "edge_too_large_likely_parser_bug",
            sourceType: fsMarket.sourceType || "unknown",
            fallbackReason: fsMarket.fallbackReason || null
          });
          rejectedRows.push({ ...row, rejectReason: "edge_too_large_likely_parser_bug" });
          continue;
        }
        controlRows.push({
          matchId: match.id,
          match: match.rawTitle,
          kickoffAt: match.kickoffAt || null,
          sport: match.sport,
          marketType,
          rawMarketName: fsMarket.marketName || marketType,
          selection: nikeMarket.selection,
          period: nikeMarket.period || "full_time",
          line: nikeMarket.line ?? null,
          nikeOdd: nikeMarket.nikeOdd,
          tipsportOdd,
          tipsportOddTrend: row.tipsportOddTrend,
          status: "MATCHED",
          compareReason: "nike_gt_tipsport",
          sourceType: fsMarket.sourceType || "unknown",
          fallbackReason: fsMarket.fallbackReason || null
        });
        comparedRows.push({
          ...row,
          ...metrics
        });
      }
      }
    }

    // Transparency rows: explicitly show market families available on Tipsport but not emitted by Nike.
    const emittedTypeSet = new Set(nikeMarketsForMatch.map((m) => m.marketType));
    const compareTypes = [...E2E_COMPARE_MARKET_TYPES];
    for (const marketType of compareTypes) {
      if (emittedTypeSet.has(marketType)) continue;
      try {
        const fsOnlyMarket = marketType === "double_chance"
          ? await scrapeFlashscoreDoubleChance({
            matchUrl: fsMatch.href,
            period: "full_time",
            session: flashscoreSession,
            enableNetworkFirst: FLASHSCORE_ENABLE_NETWORK_FIRST,
            enableDomFallback: FLASHSCORE_ENABLE_DOM_FALLBACK,
            headless: HEADLESS,
            timeoutMs: REQUEST_TIMEOUT_MS
          })
          : await scrapeFlashscoreMarketByType({
            matchUrl: fsMatch.href,
            marketType,
            period: "full_time",
            session: flashscoreSession,
            enableNetworkFirst: FLASHSCORE_ENABLE_NETWORK_FIRST,
            enableDomFallback: FLASHSCORE_ENABLE_DOM_FALLBACK,
            headless: HEADLESS,
            timeoutMs: REQUEST_TIMEOUT_MS
          });
        const tipsportRows = fsOnlyMarket.bookmakerRows.filter((b) => normalizeForCompare(b.bookmaker).includes("tipsport"));
        if (!tipsportRows.length) {
          controlRows.push({
            matchId: match.id,
            match: match.rawTitle,
            kickoffAt: match.kickoffAt || null,
            sport: match.sport,
            marketType,
            rawMarketName: fsOnlyMarket.marketName || marketType,
            selection: null,
            period: fsOnlyMarket.period || "full_time",
            line: null,
            nikeOdd: null,
            tipsportOdd: null,
            tipsportOddTrend: null,
            status: "UNSUPPORTED",
            compareReason: "nike_not_emitted_and_no_tipsport_rows_found"
          });
          continue;
        }
        const keys = selectionKeysForMarket(marketType);
        for (const row of tipsportRows) {
          for (const selectionKey of keys) {
            const tipsportOdd = row.selectionOdds?.[selectionKey] ?? null;
            if (tipsportOdd == null) continue;
            controlRows.push({
              matchId: match.id,
              match: match.rawTitle,
              kickoffAt: match.kickoffAt || null,
              sport: match.sport,
              marketType,
              rawMarketName: fsOnlyMarket.marketName || marketType,
              selection: selectionKey,
              period: fsOnlyMarket.period || "full_time",
              line: row.line ?? null,
              nikeOdd: null,
              tipsportOdd,
              tipsportOddTrend: row.selectionTrend?.[selectionKey] ?? null,
              status: "TIPSPORT_ONLY",
              compareReason: "nike_market_not_emitted_for_match"
            });
          }
        }
      } catch {
        controlRows.push({
          matchId: match.id,
          match: match.rawTitle,
          kickoffAt: match.kickoffAt || null,
          sport: match.sport,
          marketType,
          rawMarketName: marketType,
          selection: null,
          period: "full_time",
          line: null,
          nikeOdd: null,
          tipsportOdd: null,
          tipsportOddTrend: null,
          status: "UNSUPPORTED",
          compareReason: "flashscore_probe_failed_for_non_emitted_market"
        });
      }
    }
    perMatchTimings.push({
      match: match.rawTitle,
      elapsedMs: Date.now() - matchStartedAt
    });
  }

  comparedRows.sort(compareRows);
  const flashscoreValidation = validateFlashscoreMappings(matchMappings, nike.matches.length);
  const blockingRejectReasons = new Set([
    "market_type_not_allowed",
    "double_chance_market_name_mismatch",
    "double_chance_column_label_mismatch",
    "double_chance_row_parse_mismatch",
    "winner_2way_market_name_mismatch",
    "winner_2way_column_label_mismatch",
    "winner_2way_row_parse_mismatch",
    "line_mismatch",
    "period_mismatch",
    "selection_mismatch",
    "selection_source_mismatch"
  ]);
  const blockingRows = rejectedRows.filter((r) => blockingRejectReasons.has(r.rejectReason));
  const sourceDecisions = (
    Number(flashscoreSession.metrics.networkFirstHits || 0) +
    Number(flashscoreSession.metrics.domFallbackHits || 0) +
    Number(flashscoreSession.metrics.totalFailures || 0)
  );
  const fallbackRate = sourceDecisions > 0
    ? Number((Number(flashscoreSession.metrics.domFallbackHits || 0) / sourceDecisions).toFixed(4))
    : 0;
  const fallbackRateThresholdEnabled = FLASHSCORE_FAIL_IF_FALLBACK_RATE_ABOVE != null;
  const fallbackRateLimitExceeded = (
    fallbackRateThresholdEnabled &&
    fallbackRate > FLASHSCORE_FAIL_IF_FALLBACK_RATE_ABOVE
  );
  const marketValidation = {
    ok: blockingRows.length === 0 && !fallbackRateLimitExceeded,
    errors: blockingRows.map((r) => `${r.match}:${r.selection}:${r.rejectReason}`)
      .concat(
        fallbackRateLimitExceeded
          ? [`fallback_rate_exceeded:${fallbackRate}>${FLASHSCORE_FAIL_IF_FALLBACK_RATE_ABOVE}`]
          : []
      )
  };
  const finalValidation = validateFinalRows(comparedRows);

  return {
    ok: true,
    source: "live",
    nike,
    checks: {
      nikeValidation,
      flashscoreValidation,
      marketValidation,
      finalComparisonValidation: finalValidation
    },
    runtime: {
      totalMs: Date.now() - runStartedAtMs,
      flashscoreSession: {
        networkFirstEnabled: FLASHSCORE_ENABLE_NETWORK_FIRST,
        domFallbackEnabled: FLASHSCORE_ENABLE_DOM_FALLBACK,
        fallbackRateThreshold: fallbackRateThresholdEnabled ? FLASHSCORE_FAIL_IF_FALLBACK_RATE_ABOVE : null,
        browserLaunches: flashscoreSession.metrics.browserLaunches,
        networkFirstAttempts: flashscoreSession.metrics.networkFirstAttempts,
        networkFirstHits: flashscoreSession.metrics.networkFirstHits,
        domFallbackAttempts: flashscoreSession.metrics.domFallbackAttempts,
        domFallbackHits: flashscoreSession.metrics.domFallbackHits,
        fallbackUsedCount: flashscoreSession.metrics.fallbackUsedCount,
        totalFailures: flashscoreSession.metrics.totalFailures,
        fallbackRate,
        requestsObserved: flashscoreSession.networkLog.length
      },
      perMatchTimings
    },
    matchMappings,
    rejectedRows,
    controlRows,
    rows: comparedRows
  };
  } finally {
    await flashscoreSession.close().catch(() => {});
  }
}

function normalizePlaywrightError(msg) {
  const s = String(msg || "");
  if (/executable doesn't exist|Failed to launch|Could not find browser|browserType\.launch|playwright.*not found/i.test(s)) {
    return "Playwright browser missing. Run: npm run install:browsers";
  }
  if (/Timeout|timeout|Navigation timeout/i.test(s)) {
    return `Request timeout (${REQUEST_TIMEOUT_MS}ms). Try again or increase REQUEST_TIMEOUT_MS.`;
  }
  return s || "Unknown error";
}

app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

const publicDir = path.resolve(__dirname, "..", "public");
const indexPath = path.join(publicDir, "index.html");

app.get("/", (req, res) => {
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error("[GET /] sendFile error:", err?.message);
      res.status(500).setHeader("Content-Type", "application/json").json({
        ok: false,
        error: "index.html not found",
        hint: "Spúšťaj server z priečinka projektu (npm start)."
      });
    }
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "nike-flash-backend", headless: HEADLESS, port: PORT });
});

app.get("/api/nike-superkurzy", async (_req, res) => {
  try {
    const data = await scrapeNikeSuperkurzy({ headless: HEADLESS, timeoutMs: REQUEST_TIMEOUT_MS });
    res.json({ ok: true, source: "live", ...data });
  } catch (err) {
    const message = normalizePlaywrightError(err?.message);
    console.error("[nike-superkurzy]", err?.message);
    res.status(500).setHeader("Content-Type", "application/json").json({ ok: false, error: message });
  }
});

app.get("/api/debug/nike", async (_req, res) => {
  try {
    const data = await debugNikeSuperkurzy({ headless: HEADLESS, timeoutMs: REQUEST_TIMEOUT_MS });
    res.json({
      ok: true,
      title: data.debugInfo.title,
      finalUrl: data.debugInfo.finalUrl,
      firstLines: data.debugInfo.firstLines,
      extractedCandidateCards: data.debugInfo.sampleCards,
      extractedOddsArrays: data.debugInfo.sampleCards.map((x) => x.odds),
      parserDebug: {
        candidateCardsCount: data.debugInfo.candidateCardsCount,
        candidateUniqueMatchCount: data.debugInfo.candidateUniqueMatchCount,
        candidateUniqueMatches: data.debugInfo.candidateUniqueMatches,
        parsedMatchesCount: data.debugInfo.parsedMatchesCount,
        parsedMarketsCount: data.debugInfo.parsedMarketsCount
      }
    });
  } catch (err) {
    const message = normalizePlaywrightError(err?.message);
    console.error("[debug/nike]", err?.message);
    res.status(500).setHeader("Content-Type", "application/json").json({ ok: false, error: message });
  }
});

app.get("/api/flashscore/search", async (req, res) => {
  const { homeTeam, awayTeam, sport, tournament, kickoffAt } = req.query;
  if (!homeTeam || !awayTeam) {
    return res.status(400).setHeader("Content-Type", "application/json").json({ ok: false, error: "Query parameters homeTeam and awayTeam are required." });
  }
  try {
    const result = await searchFlashscoreMatch({
      homeTeam: String(homeTeam).trim(),
      awayTeam: String(awayTeam).trim(),
      sport: sport || "football",
      tournament: tournament || "",
      kickoffAt: kickoffAt || null,
      headless: HEADLESS,
      timeoutMs: REQUEST_TIMEOUT_MS
    });
    res.json({ ok: true, result: result ?? null });
  } catch (err) {
    const message = normalizePlaywrightError(err?.message);
    console.error("[flashscore/search]", err?.message);
    res.status(500).setHeader("Content-Type", "application/json").json({ ok: false, error: message });
  }
});

app.get("/api/pipeline/nike-vs-tipsport", async (_req, res) => {
  try {
    const pipeline = await buildNikeTipsportPipeline();
    if (!pipeline.ok) return res.status(500).json({ ok: false, error: pipeline.error, stage: pipeline.stage });
    res.json({
      ok: true,
      source: pipeline.source,
      checks: {
        nikeSuperponukaCount: pipeline.nike.matches.length,
        nikeSuperponukaValid: pipeline.checks.nikeValidation.ok,
        flashscoreMatchedCount: pipeline.matchMappings.filter((m) => m.matched).length,
        flashscoreValidation: pipeline.checks.flashscoreValidation,
        marketValidation: pipeline.checks.marketValidation,
        finalComparisonValidation: pipeline.checks.finalComparisonValidation
      },
      runtime: pipeline.runtime,
      sourceCoverage: {
        rowsBySource: pipeline.rows.reduce((acc, row) => {
          const key = row.sourceType || "unknown";
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})
      },
      matchMappings: pipeline.matchMappings,
      rows: pipeline.rows
    });
  } catch (err) {
    const message = normalizePlaywrightError(err?.message);
    console.error("[pipeline/nike-vs-tipsport]", err?.message);
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/debug/flashscore", async (_req, res) => {
  try {
    const pipeline = await buildNikeTipsportPipeline();
    if (!pipeline.ok) return res.status(500).json({ ok: false, error: pipeline.error, stage: pipeline.stage });
    res.json({
      ok: true,
      checks: {
        nikeValidation: pipeline.checks.nikeValidation,
        flashscoreValidation: pipeline.checks.flashscoreValidation
      },
      matchMappings: pipeline.matchMappings
    });
  } catch (err) {
    const message = normalizePlaywrightError(err?.message);
    console.error("[debug/flashscore]", err?.message);
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/debug/compare", async (_req, res) => {
  try {
    const pipeline = await buildNikeTipsportPipeline();
    if (!pipeline.ok) return res.status(500).json({ ok: false, error: pipeline.error, stage: pipeline.stage });
    res.json({
      ok: true,
      checks: pipeline.checks,
      rowsKept: pipeline.rows.length,
      rowsRejected: pipeline.rejectedRows.length,
      rejectedRows: pipeline.rejectedRows,
      rows: pipeline.rows
    });
  } catch (err) {
    const message = normalizePlaywrightError(err?.message);
    console.error("[debug/compare]", err?.message);
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/debug/full-check", async (_req, res) => {
  try {
    const pipeline = await buildNikeTipsportPipeline();
    if (!pipeline.ok) return res.status(500).json({ ok: false, error: pipeline.error, stage: pipeline.stage });

    const requiredNikeTitles = new Set(EXPECTED_SUPERPONUKA_SNAPSHOT);
    const nikeTitles = pipeline.nike.matches.map((m) => m.rawTitle);
    const nikeExactListOk = STRICT_EXPECTED_SUPERPONUKA
      ? (
        nikeTitles.length === EXPECTED_SUPERPONUKA_SNAPSHOT.length &&
        new Set(nikeTitles).size === EXPECTED_SUPERPONUKA_SNAPSHOT.length &&
        nikeTitles.every((t) => requiredNikeTitles.has(t))
      )
      : true;

    const hrefByNikeTitle = new Map(
      pipeline.matchMappings
        .filter((m) => m.matched && m.flashscoreHref)
        .map((m) => [m.nikeMatch, m.flashscoreHref])
    );
    const pickSampleUrlForMarket = (marketType) => {
      if (marketType === "match_winner_2way") {
        const tennisMatch = pipeline.nike.matches.find((m) => m.sport === "tennis");
        if (tennisMatch) return hrefByNikeTitle.get(tennisMatch.rawTitle) || null;
      }
      if (marketType === "double_chance") {
        const nonTennis = pipeline.nike.matches.find((m) => m.sport !== "tennis");
        if (nonTennis) return hrefByNikeTitle.get(nonTennis.rawTitle) || null;
      }
      const fallback = pipeline.nike.matches.find((m) => hrefByNikeTitle.has(m.rawTitle));
      return fallback ? hrefByNikeTitle.get(fallback.rawTitle) : null;
    };
    const marketTypes = getAllMarketHandlers().map((h) => h.marketType);

    const marketSamples = [];
    for (const marketType of marketTypes) {
      const sampleUrl = pickSampleUrlForMarket(marketType);
      if (!sampleUrl) {
        marketSamples.push({
          marketType,
          marketName: null,
          sampleMatchUrl: null,
          columnLabels: [],
          rowsCount: 0,
          tipsportFound: false,
          tipsportLine: null,
          tipsportSelectionOdds: null
        });
        continue;
      }
      const parsed = marketType === "double_chance"
        ? await scrapeFlashscoreDoubleChance({
          matchUrl: sampleUrl,
          enableNetworkFirst: FLASHSCORE_ENABLE_NETWORK_FIRST,
          enableDomFallback: FLASHSCORE_ENABLE_DOM_FALLBACK,
          headless: HEADLESS,
          timeoutMs: REQUEST_TIMEOUT_MS
        })
        : await scrapeFlashscoreMarketByType({
          matchUrl: sampleUrl,
          marketType,
          enableNetworkFirst: FLASHSCORE_ENABLE_NETWORK_FIRST,
          enableDomFallback: FLASHSCORE_ENABLE_DOM_FALLBACK,
          headless: HEADLESS,
          timeoutMs: REQUEST_TIMEOUT_MS
        });
        const tipsportRow = parsed.bookmakerRows.find((b) => normalizeForCompare(b.bookmaker).includes("tipsport")) || null;
        marketSamples.push({
          marketType,
          marketName: parsed.marketName || null,
          sampleMatchUrl: sampleUrl,
          columnLabels: parsed.columnLabels || [],
          rowsCount: parsed.bookmakerRows.length,
          tipsportFound: Boolean(tipsportRow),
          tipsportLine: tipsportRow?.line ?? null,
          tipsportSelectionOdds: tipsportRow?.selectionOdds ?? null
        });
    }

    const allFinalRowsNikeGtTipsport = pipeline.rows.every((r) => isNikeGreaterThanTipsport(r.nikeOdd, r.tipsportOdd));
    const nikeEmittedByType = Object.fromEntries(
      marketTypes.map((t) => [t, pipeline.nike.markets.filter((m) => m.marketType === t).length])
    );
    const supportMatrix = marketTypes.map((marketType) => {
      const sample = marketSamples.find((m) => m.marketType === marketType) || null;
      const handler = getAllMarketHandlers().find((h) => h.marketType === marketType) || null;
      const nikeEmits = (nikeEmittedByType[marketType] || 0) > 0;
      const flashscoreParses = Boolean(sample && sample.rowsCount > 0 && sample.tipsportFound);
      const compareWired = E2E_COMPARE_MARKET_TYPES.has(marketType) && Boolean(handler?.compareEnabled);
      const tested = compareWired && nikeEmits;
      const finalStatus = compareWired ? (nikeEmits ? "supported_e2e" : "wired_but_not_emitted_by_nike") : "disabled_compare_parser_only";
      return {
        marketType,
        nikeEmits,
        flashscoreParses,
        compareWired,
        tested,
        finalStatus
      };
    });
    const response = {
      ok: true,
      status: (
        pipeline.checks.nikeValidation.ok &&
        nikeExactListOk &&
        pipeline.checks.flashscoreValidation.ok &&
        pipeline.checks.marketValidation.ok &&
        pipeline.checks.finalComparisonValidation.ok &&
        allFinalRowsNikeGtTipsport
      ) ? "PASS" : "FAIL",
      checks: {
        nikeValidation: pipeline.checks.nikeValidation,
        nikeExactExpectedList: nikeExactListOk,
        strictExpectedSnapshotMode: STRICT_EXPECTED_SUPERPONUKA,
        flashscoreValidation: pipeline.checks.flashscoreValidation,
        marketValidation: pipeline.checks.marketValidation,
        finalComparisonValidation: pipeline.checks.finalComparisonValidation,
        allFinalRowsNikeGtTipsport
      },
      runtime: pipeline.runtime,
      sourceCoverage: {
        finalRowsBySource: pipeline.rows.reduce((acc, row) => {
          const key = row.sourceType || "unknown";
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
        finalRowsByFallbackReason: pipeline.rows.reduce((acc, row) => {
          const key = row.fallbackReason || "none";
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
        rejectedRowsBySource: pipeline.rejectedRows.reduce((acc, row) => {
          const key = row.sourceType || "unknown";
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
        rejectedRowsByFailureReason: pipeline.rejectedRows.reduce((acc, row) => {
          const key = row.sourceFailureReason || "none";
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})
      },
      nike: {
        count: pipeline.nike.matches.length,
        matches: nikeTitles
      },
      finalRows: {
        count: pipeline.rows.length,
        rows: pipeline.rows
      },
      matchMappings: pipeline.matchMappings,
      marketSamples,
      supportMatrix,
      hint: "Open only this endpoint for full QA summary."
    };
    res.json(response);
  } catch (err) {
    const message = normalizePlaywrightError(err?.message);
    console.error("[debug/full-check]", err?.message);
    res.status(500).setHeader("Content-Type", "application/json").json({ ok: false, error: message });
  }
});

app.get("/api/flashscore/double-chance", async (req, res) => {
  const { matchUrl } = req.query;
  if (!matchUrl || !String(matchUrl).trim()) {
    return res.status(400).setHeader("Content-Type", "application/json").json({ ok: false, error: "Query parameter matchUrl is required." });
  }
  try {
    const result = await scrapeFlashscoreDoubleChance({
      matchUrl: String(matchUrl).trim(),
      enableNetworkFirst: FLASHSCORE_ENABLE_NETWORK_FIRST,
      enableDomFallback: FLASHSCORE_ENABLE_DOM_FALLBACK,
      headless: HEADLESS,
      timeoutMs: REQUEST_TIMEOUT_MS
    });
    res.json({ ok: true, result });
  } catch (err) {
    const message = normalizePlaywrightError(err?.message);
    console.error("[flashscore/double-chance]", err?.message);
    res.status(500).setHeader("Content-Type", "application/json").json({ ok: false, error: message });
  }
});

app.get("/api/flashscore/market-2way", async (req, res) => {
  const { matchUrl, marketType, period } = req.query;
  if (!matchUrl || !String(matchUrl).trim()) {
    return res.status(400).setHeader("Content-Type", "application/json").json({ ok: false, error: "Query parameter matchUrl is required." });
  }
  if (!marketType || !String(marketType).trim()) {
    return res.status(400).setHeader("Content-Type", "application/json").json({ ok: false, error: "Query parameter marketType is required." });
  }
  try {
    const result = await scrapeFlashscoreMarketByType({
      matchUrl: String(matchUrl).trim(),
      marketType: String(marketType).trim(),
      period: String(period || "full_time").trim(),
      enableNetworkFirst: FLASHSCORE_ENABLE_NETWORK_FIRST,
      enableDomFallback: FLASHSCORE_ENABLE_DOM_FALLBACK,
      headless: HEADLESS,
      timeoutMs: REQUEST_TIMEOUT_MS
    });
    res.json({ ok: true, result });
  } catch (err) {
    const message = normalizePlaywrightError(err?.message);
    console.error("[flashscore/market-2way]", err?.message);
    res.status(500).setHeader("Content-Type", "application/json").json({ ok: false, error: message });
  }
});

app.get("/api/ui/summary", async (_req, res) => {
  try {
    const force = String(_req.query?.force || "") === "1";
    const pipeline = await getUiPipeline({ force });
    if (!pipeline.ok) return res.status(500).json({ ok: false, error: pipeline.error, stage: pipeline.stage });
    res.json({
      ok: true,
      updatedAt: new Date().toISOString(),
      superponukaMatches: pipeline.nike.matches.length,
      nikeEmittedMarkets: pipeline.nike.markets.length,
      matchedComparedRows: pipeline.controlRows.filter((r) => r.status === "MATCHED").length,
      finalEdgeRows: pipeline.rows.length
    });
  } catch (err) {
    const message = normalizePlaywrightError(err?.message);
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/ui/final-edges", async (_req, res) => {
  try {
    const force = String(_req.query?.force || "") === "1";
    const pipeline = await getUiPipeline({ force });
    if (!pipeline.ok) return res.status(500).json({ ok: false, error: pipeline.error, stage: pipeline.stage });
    res.json({ ok: true, updatedAt: new Date().toISOString(), rows: pipeline.rows });
  } catch (err) {
    const message = normalizePlaywrightError(err?.message);
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/ui/control-table", async (_req, res) => {
  try {
    const force = String(_req.query?.force || "") === "1";
    const pipeline = await getUiPipeline({ force });
    if (!pipeline.ok) return res.status(500).json({ ok: false, error: pipeline.error, stage: pipeline.stage });
    res.json({
      ok: true,
      updatedAt: new Date().toISOString(),
      rows: pipeline.controlRows
    });
  } catch (err) {
    const message = normalizePlaywrightError(err?.message);
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/ui/snapshot", async (req, res) => {
  try {
    const force = String(req.query?.force || "") === "1";
    const pipeline = await getUiPipeline({ force });
    if (!pipeline.ok) return res.status(500).json({ ok: false, error: pipeline.error, stage: pipeline.stage });
    const updatedAt = new Date().toISOString();
    res.json({
      ok: true,
      updatedAt,
      summary: {
        ok: true,
        updatedAt,
        superponukaMatches: pipeline.nike.matches.length,
        nikeEmittedMarkets: pipeline.nike.markets.length,
        matchedComparedRows: pipeline.controlRows.filter((r) => r.status === "MATCHED").length,
        finalEdgeRows: pipeline.rows.length
      },
      finalEdges: {
        ok: true,
        updatedAt,
        rows: pipeline.rows
      },
      controlTable: {
        ok: true,
        updatedAt,
        rows: pipeline.controlRows
      }
    });
  } catch (err) {
    const message = normalizePlaywrightError(err?.message);
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/ui/all-2way-opportunities", async (req, res) => {
  try {
    const force = String(req.query?.force || "") === "1";
    const pipeline = await getUiPipeline({ force });
    if (!pipeline.ok) return res.status(500).json({ ok: false, error: pipeline.error, stage: pipeline.stage });
    const rows = build2WayOpportunities(pipeline);
    res.json({ ok: true, updatedAt: new Date().toISOString(), count: rows.length, rows });
  } catch (err) {
    const message = normalizePlaywrightError(err?.message);
    console.error("[ui/all-2way-opportunities]", err?.message);
    res.status(500).json({ ok: false, error: message });
  }
});

// ---------------------------------------------------------------------------
// Flashscore Monitor proxy — forward /fs/* to Python dashboard on port 8500
// ---------------------------------------------------------------------------
import http from "node:http";

const FS_MONITOR_PORT = 8500;

app.use("/fs", (req, res) => {
  // Rewrite path: /fs/scan?sport=football → /scan?sport=football
  const targetPath = req.url === "/" || req.url === "" ? "/" : req.url;
  const options = {
    hostname: "127.0.0.1",
    port: FS_MONITOR_PORT,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${FS_MONITOR_PORT}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    // Stream response (important for SSE /events endpoint)
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: "Flashscore Monitor is not running (port 8500)" });
    }
  });

  req.pipe(proxyReq, { end: true });
});

app.use((_req, res) => {
  res.status(404).setHeader("Content-Type", "application/json").json({ ok: false, error: "Not found" });
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection:", reason);
});

const server = app.listen(PORT, () => {
  console.log(`nike-flash-backend listening on http://localhost:${PORT}`);
});

function shutdown(signal) {
  console.log(`\n${signal}; shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
