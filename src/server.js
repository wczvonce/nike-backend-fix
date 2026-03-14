import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { scrapeNikeSuperkurzy, debugNikeSuperkurzy } from "./scrapers/nike.js";
import { searchFlashscoreMatch, scrapeFlashscoreDoubleChance, scrapeFlashscoreMarketByType } from "./scrapers/flashscore.js";
import { EXPECTED_SUPERPONUKA_SNAPSHOT, EXPECTED_SUPERPONUKA_SPORT_BY_TITLE } from "./config/superponuka.js";
import {
  normalizeForCompare,
  round2,
  compareRows,
  validateMarketCandidate,
  validateFinalRows,
  isLineMarket,
  isHomeAwayMarket,
  mapSelectionForSwap,
  mapLineForSwap,
  sameLine,
  computeMetrics
} from "./utils/pipeline-logic.js";

dotenv.config();
const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json({ limit: "2mb" }));
const PORT = Number(process.env.PORT || 3001);
const HEADLESS = String(process.env.HEADLESS || "true") !== "false";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 45000);
const STRICT_EXPECTED_SUPERPONUKA = String(process.env.STRICT_EXPECTED_SUPERPONUKA || "true") === "true";

function validateSuperponuka(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return { ok: false, error: "Nike parser mismatch: no matches parsed" };
  const got = matches.map((m) => normalizeForCompare(m.rawTitle));
  if (new Set(got).size !== got.length) return { ok: false, error: "Nike parser mismatch: duplicate matches found" };
  for (const m of matches) {
    const key = normalizeForCompare(m.rawTitle);
    if (!m.sport || m.sport === "unknown") return { ok: false, error: `Nike parser mismatch: unknown sport for "${m.rawTitle}"` };
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


function validateFlashscoreMappings(matchMappings) {
  const errors = [];
  if (!Array.isArray(matchMappings) || matchMappings.length !== 4) {
    errors.push(`expected 4 mappings, got ${matchMappings?.length ?? 0}`);
  }
  const unmatched = (matchMappings || []).filter((m) => !m.matched);
  if (unmatched.length) errors.push(`unmatched nike events: ${unmatched.map((m) => m.nikeMatch).join(", ")}`);
  const lowConfidence = (matchMappings || []).filter((m) => m.matched && Number(m.confidence || 0) < 140);
  if (lowConfidence.length) errors.push(`low confidence mappings: ${lowConfidence.map((m) => m.nikeMatch).join(", ")}`);
  const hrefs = (matchMappings || []).filter((m) => m.matched).map((m) => m.flashscoreHref);
  if (new Set(hrefs).size !== hrefs.length) errors.push("duplicate flashscore href mapping");
  return { ok: errors.length === 0, errors };
}


async function buildNikeTipsportPipeline() {
  const nike = await scrapeNikeSuperkurzy({ headless: HEADLESS, timeoutMs: REQUEST_TIMEOUT_MS });
  const nikeValidation = validateSuperponuka(nike.matches);
  if (!nikeValidation.ok) {
    return { ok: false, error: nikeValidation.error, stage: "nike_validation" };
  }

  const comparedRows = [];
  const rejectedRows = [];
  const matchMappings = [];

  for (const match of nike.matches) {
    const fsMatch = await searchFlashscoreMatch({
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      sport: match.sport,
      tournament: match.tournament || "",
      headless: HEADLESS,
      timeoutMs: REQUEST_TIMEOUT_MS
    });

    if (!fsMatch?.href) {
      matchMappings.push({ nikeMatch: match.rawTitle, matched: false, reason: "flashscore_not_found" });
      continue;
    }
    const swapped = isSwappedOrientation(match, fsMatch);
    matchMappings.push({
      nikeMatch: match.rawTitle,
      matched: true,
      flashscoreHref: fsMatch.href,
      confidence: fsMatch.confidence,
      orientationSwapped: swapped,
      flashscoreHomeTeam: fsMatch.homeTeam,
      flashscoreAwayTeam: fsMatch.awayTeam
    });

    const nikeMarketsForMatch = nike.markets.filter((m) => m.matchId === match.id);
    const marketTypes = [...new Set(nikeMarketsForMatch.map((m) => m.marketType))];

    for (const marketType of marketTypes) {
      const fsMarket = marketType === "double_chance"
        ? await scrapeFlashscoreDoubleChance({ matchUrl: fsMatch.href, headless: HEADLESS, timeoutMs: REQUEST_TIMEOUT_MS })
        : await scrapeFlashscoreMarketByType({ matchUrl: fsMatch.href, marketType, headless: HEADLESS, timeoutMs: REQUEST_TIMEOUT_MS });
      const tipsportRows = fsMarket.bookmakerRows.filter((b) => normalizeForCompare(b.bookmaker).includes("tipsport"));
      const nikeMarketRows = nikeMarketsForMatch.filter((m) => m.marketType === marketType);

      for (const nikeMarket of nikeMarketRows) {
        let mappedSelection = nikeMarket.selection;
        if (marketType === "double_chance") mappedSelection = mapSelectionForSwap(nikeMarket.selection, swapped);
        else if (isHomeAwayMarket(marketType)) mappedSelection = mapSelectionForSwap(nikeMarket.selection, swapped);
        const mappedLine = mapLineForSwap(nikeMarket.line ?? null, marketType, swapped);
        const tipsportRow = isLineMarket(marketType)
          ? tipsportRows.find((row) => sameLine(row.line, mappedLine))
          : tipsportRows[0];
        const tipsportOdd = tipsportRow?.selectionOdds?.[mappedSelection] ?? null;
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
          flashscoreMatchUrl: fsMatch.href,
          sourceMarketName: fsMarket.marketName || null,
          sourcePeriodName: fsMarket.periodName || null,
          columnLabels: fsMarket.columnLabels || [],
          rawBookmakerRowText: tipsportRow?.rawRowText || "",
          extractedOddsArray: tipsportRow?.extractedOddsArray || [],
          sourceSelection: mappedSelection
        };
        const marketValidation = validateMarketCandidate(row);
        if (!marketValidation.ok) {
          rejectedRows.push({ ...row, rejectReason: marketValidation.reason });
          continue;
        }
        if (!(row.nikeOdd > row.tipsportOdd)) {
          rejectedRows.push({ ...row, rejectReason: "nike_not_gt_tipsport" });
          continue;
        }
        const metrics = computeMetrics(row.nikeOdd, row.tipsportOdd);
        comparedRows.push({
          ...row,
          ...metrics
        });
      }
    }
  }

  comparedRows.sort(compareRows);
  const flashscoreValidation = validateFlashscoreMappings(matchMappings);
  const marketValidation = { ok: rejectedRows.filter((r) => r.rejectReason !== "nike_not_gt_tipsport").length === 0, errors: rejectedRows.filter((r) => r.rejectReason !== "nike_not_gt_tipsport").map((r) => `${r.match}:${r.selection}:${r.rejectReason}`) };
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
    matchMappings,
    rejectedRows,
    rows: comparedRows
  };
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
  const { homeTeam, awayTeam, sport, tournament } = req.query;
  if (!homeTeam || !awayTeam) {
    return res.status(400).setHeader("Content-Type", "application/json").json({ ok: false, error: "Query parameters homeTeam and awayTeam are required." });
  }
  try {
    const result = await searchFlashscoreMatch({
      homeTeam: String(homeTeam).trim(),
      awayTeam: String(awayTeam).trim(),
      sport: sport || "football",
      tournament: tournament || "",
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
    const nikeExactListOk =
      nikeTitles.length === 4 &&
      new Set(nikeTitles).size === 4 &&
      nikeTitles.every((t) => requiredNikeTitles.has(t));

    const sampleFlashscoreUrl =
      pipeline.matchMappings.find((m) => m.matched && m.flashscoreHref)?.flashscoreHref || null;
    const marketTypes = [
      "double_chance",
      "match_winner_2way",
      "over_under_2way",
      "asian_handicap_2way",
      "both_teams_to_score",
      "draw_no_bet_2way",
      "european_handicap_2way"
    ];

    const marketSamples = [];
    if (sampleFlashscoreUrl) {
      for (const marketType of marketTypes) {
        const parsed = marketType === "double_chance"
          ? await scrapeFlashscoreDoubleChance({ matchUrl: sampleFlashscoreUrl, headless: HEADLESS, timeoutMs: REQUEST_TIMEOUT_MS })
          : await scrapeFlashscoreMarketByType({ matchUrl: sampleFlashscoreUrl, marketType, headless: HEADLESS, timeoutMs: REQUEST_TIMEOUT_MS });
        const tipsportRow = parsed.bookmakerRows.find((b) => normalizeForCompare(b.bookmaker).includes("tipsport")) || null;
        marketSamples.push({
          marketType,
          marketName: parsed.marketName || null,
          columnLabels: parsed.columnLabels || [],
          rowsCount: parsed.bookmakerRows.length,
          tipsportFound: Boolean(tipsportRow),
          tipsportLine: tipsportRow?.line ?? null,
          tipsportSelectionOdds: tipsportRow?.selectionOdds ?? null
        });
      }
    }

    const allFinalRowsNikeGtTipsport = pipeline.rows.every((r) => r.nikeOdd > r.tipsportOdd);
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
  const { matchUrl, marketType } = req.query;
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
