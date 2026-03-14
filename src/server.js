import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { scrapeNikeSuperkurzy, debugNikeSuperkurzy } from "./scrapers/nike.js";
import { searchFlashscoreMatch, scrapeFlashscoreDoubleChance, scrapeFlashscoreTipsportWinner2Way } from "./scrapers/flashscore.js";

dotenv.config();
const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json({ limit: "2mb" }));
const PORT = Number(process.env.PORT || 3001);
const HEADLESS = String(process.env.HEADLESS || "true") !== "false";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 45000);
const EXPECTED_SUPERPONUKA = [
  "Chelsea vs Newcastle Utd.",
  "Como vs AS Roma",
  "Michalovce vs Spišská N. Ves",
  "Sabalenka A. vs Rybakina E."
];
const EXPECTED_SUPERPONUKA_SPORT = {
  "chelsea vs newcastle utd.": "football",
  "como vs as roma": "football",
  "michalovce vs spisska n. ves": "hockey",
  "sabalenka a. vs rybakina e.": "tennis"
};

function normalizeForCompare(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function validateSuperponuka(matches) {
  if (!Array.isArray(matches) || matches.length !== 4) return { ok: false, error: `Nike parser mismatch: expected 4 matches, got ${matches?.length ?? 0}` };
  const got = matches.map((m) => normalizeForCompare(m.rawTitle));
  const expected = EXPECTED_SUPERPONUKA.map((m) => normalizeForCompare(m));
  for (const name of expected) {
    if (!got.includes(name)) return { ok: false, error: `Nike parser mismatch: missing match "${name}"` };
  }
  if (new Set(got).size !== got.length) return { ok: false, error: "Nike parser mismatch: duplicate matches found" };
  for (const m of matches) {
    const key = normalizeForCompare(m.rawTitle);
    const expectedSport = EXPECTED_SUPERPONUKA_SPORT[key];
    if (!expectedSport) return { ok: false, error: `Nike parser mismatch: unexpected extra match "${m.rawTitle}"` };
    if (m.sport !== expectedSport) return { ok: false, error: `Nike parser mismatch: wrong sport for "${m.rawTitle}"` };
  }
  return { ok: true };
}

function toDateTimeSortable(match) {
  const dt = match?.kickoffAt || "";
  return dt || "9999-12-31T23:59:59";
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

function mapSelectionForSwap(selection, swapped) {
  if (!swapped) return selection;
  if (selection === "1x") return "x2";
  if (selection === "x2") return "1x";
  return selection; // 12 stays 12
}

function round2(n) {
  return Number(Number(n).toFixed(2));
}

function compareRows(a, b) {
  if (b.probabilityEdgePp !== a.probabilityEdgePp) return b.probabilityEdgePp - a.probabilityEdgePp;
  if (b.diff !== a.diff) return b.diff - a.diff;
  return toDateTimeSortable(a).localeCompare(toDateTimeSortable(b));
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

function validateMarketCandidate(row) {
  const allowed = new Set(["double_chance", "match_winner_2way", "over_under_2way", "btts_yes_no", "handicap_2way"]);
  if (!allowed.has(row.marketType)) return { ok: false, reason: "market_type_not_allowed" };
  if (row.nikeOdd == null || row.tipsportOdd == null) return { ok: false, reason: "missing_odds" };
  if (!(row.nikeOdd > 1 && row.tipsportOdd > 1)) return { ok: false, reason: "invalid_odds_range" };
  if (row.period !== "full_time") return { ok: false, reason: "period_mismatch" };
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
    if (!exactDcLabels) {
      return { ok: false, reason: "double_chance_column_label_mismatch" };
    }
    if (!Array.isArray(row.extractedOddsArray) || row.extractedOddsArray.length !== 3) {
      return { ok: false, reason: "double_chance_row_parse_mismatch" };
    }
  }
  if (row.marketType === "match_winner_2way" && !["home", "away"].includes(row.selection)) return { ok: false, reason: "selection_mismatch" };
  if (row.marketType === "match_winner_2way") {
    const marketName = normalizeForCompare(row.sourceMarketName || "");
    if (!(marketName.includes("1x2") || marketName.includes("vitaz") || marketName.includes("winner"))) {
      return { ok: false, reason: "winner_2way_market_name_mismatch" };
    }
  }
  return { ok: true };
}

function validateFinalRows(rows) {
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

    if (match.sport === "tennis") {
      const fsWinner = await scrapeFlashscoreTipsportWinner2Way({ matchUrl: fsMatch.href, headless: HEADLESS, timeoutMs: REQUEST_TIMEOUT_MS });
        const tipsport = fsWinner.bookmakerRows.find((b) => normalizeForCompare(b.bookmaker).includes("tipsport"));
      const nikeHome = nike.markets.find((m) => m.matchId === match.id && m.marketType === "match_winner_2way" && m.selection === "home");
      const nikeAway = nike.markets.find((m) => m.matchId === match.id && m.marketType === "match_winner_2way" && m.selection === "away");
      const tipsportHomeOdd = swapped ? tipsport?.selectionOdds?.away ?? null : tipsport?.selectionOdds?.home ?? null;
      const tipsportAwayOdd = swapped ? tipsport?.selectionOdds?.home ?? null : tipsport?.selectionOdds?.away ?? null;
      const pairs = [
        { selection: "home", nikeOdd: nikeHome?.nikeOdd ?? null, tipsportOdd: tipsportHomeOdd },
        { selection: "away", nikeOdd: nikeAway?.nikeOdd ?? null, tipsportOdd: tipsportAwayOdd }
      ];
      for (const p of pairs) {
        const row = {
          matchId: match.id,
          match: match.rawTitle,
          sport: match.sport,
          tournament: match.tournament,
          kickoffAt: match.kickoffAt || null,
          marketType: "match_winner_2way",
          period: "full_time",
          line: null,
          selection: p.selection,
          nikeOdd: p.nikeOdd,
          tipsportOdd: p.tipsportOdd,
            flashscoreMatchUrl: fsMatch.href,
            sourceMarketName: fsWinner.marketName || null,
            sourcePeriodName: fsWinner.periodName || null,
            columnLabels: fsWinner.columnLabels || [],
            rawBookmakerRowText: tipsport?.rawRowText || "",
            extractedOddsArray: tipsport?.extractedOddsArray || []
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
        const diff = row.nikeOdd - row.tipsportOdd;
        const percentDiff = (diff / row.tipsportOdd) * 100;
        const probabilityEdgePp = ((1 / row.tipsportOdd) - (1 / row.nikeOdd)) * 100;
        comparedRows.push({
          ...row,
          nikeOdd: round2(row.nikeOdd),
          tipsportOdd: round2(row.tipsportOdd),
          diff: round2(diff),
          percentDiff: round2(percentDiff),
          probabilityEdgePp: round2(probabilityEdgePp)
        });
      }
    } else {
      const dc = await scrapeFlashscoreDoubleChance({ matchUrl: fsMatch.href, headless: HEADLESS, timeoutMs: REQUEST_TIMEOUT_MS });
        const tipsport = dc.bookmakerRows.find((b) => normalizeForCompare(b.bookmaker).includes("tipsport"));
      const nikeDcMarkets = nike.markets.filter((m) => m.matchId === match.id && m.marketType === "double_chance");
      for (const nikeMarket of nikeDcMarkets) {
        const mappedSelection = mapSelectionForSwap(nikeMarket.selection, swapped);
        const row = {
          matchId: match.id,
          match: match.rawTitle,
          sport: match.sport,
          tournament: match.tournament,
          kickoffAt: match.kickoffAt || null,
          marketType: "double_chance",
          period: "full_time",
          line: null,
          selection: nikeMarket.selection,
          nikeOdd: nikeMarket.nikeOdd,
          tipsportOdd: tipsport?.selectionOdds?.[mappedSelection] ?? null,
            flashscoreMatchUrl: fsMatch.href,
            sourceMarketName: dc.marketName || null,
            sourcePeriodName: dc.periodName || null,
            columnLabels: dc.columnLabels || [],
            rawBookmakerRowText: tipsport?.rawRowText || "",
            extractedOddsArray: tipsport?.extractedOddsArray || [],
            mappedSelection: mappedSelection
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
        const diff = row.nikeOdd - row.tipsportOdd;
        const percentDiff = (diff / row.tipsportOdd) * 100;
        const probabilityEdgePp = ((1 / row.tipsportOdd) - (1 / row.nikeOdd)) * 100;
        comparedRows.push({
          ...row,
          nikeOdd: round2(row.nikeOdd),
          tipsportOdd: round2(row.tipsportOdd),
          diff: round2(diff),
          percentDiff: round2(percentDiff),
          probabilityEdgePp: round2(probabilityEdgePp)
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
