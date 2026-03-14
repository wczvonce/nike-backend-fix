import { chromium } from "playwright";
import { normalizeTeamName, parseOdd } from "../utils/normalize.js";
import { delay } from "../utils/delay.js";

const FLASHSCORE_BASE = "https://www.flashscore.sk";
const DEFAULT_VIEWPORT = { width: 1280, height: 1800 };
const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

function scoreMatch(targetHome, targetAway, fsHome, fsAway) {
  const tHome = normalizeTeamName(targetHome);
  const tAway = normalizeTeamName(targetAway);
  const fHome = normalizeTeamName(fsHome);
  const fAway = normalizeTeamName(fsAway);
  const sim = (a, b) => {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.85;
    const aTokens = new Set(a.split(" ").filter(Boolean));
    const bTokens = new Set(b.split(" ").filter(Boolean));
    const intersection = [...aTokens].filter((x) => bTokens.has(x)).length;
    if (!intersection) return 0;
    return intersection / Math.max(aTokens.size, bTokens.size);
  };
  const straight = sim(tHome, fHome) + sim(tAway, fAway);
  const reversed = sim(tHome, fAway) + sim(tAway, fHome);
  return Math.round(Math.max(straight, reversed) * 100);
}

function programUrlsByTournament(sport = "football", tournament = "") {
  const t = normalizeTeamName(tournament);
  const urls = new Set([`${FLASHSCORE_BASE}/`]);
  if (sport === "football") {
    if (t.includes("anglicko") && t.includes("i liga")) urls.add(`${FLASHSCORE_BASE}/futbal/anglicko/premier-league/program/`);
    if (t.includes("taliansko") && t.includes("i liga")) urls.add(`${FLASHSCORE_BASE}/futbal/taliansko/serie-a/program/`);
    if (t.includes("nike liga")) urls.add(`${FLASHSCORE_BASE}/futbal/slovensko/nike-liga/program/`);
  } else if (sport === "hockey") {
    if (t.includes("slovensko") && t.includes("extraliga")) urls.add(`${FLASHSCORE_BASE}/hokej/slovensko/extraliga/program/`);
  } else if (sport === "tennis") {
    if (t.includes("wta indian wells")) urls.add(`${FLASHSCORE_BASE}/tenis/wta-dvojhry/indian-wells/program/`);
    if (t.includes("atp indian wells")) urls.add(`${FLASHSCORE_BASE}/tenis/atp-dvojhry/indian-wells/program/`);
  }
  return [...urls];
}

function extractMatchAnchors(html = "") {
  const matches = [];
  const regex = /<a href="(\/zapas\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const href = m[1];
    const text = (m[2] || "").replace(/\s+/g, " ").trim();
    if (!text || !/\s-\s/.test(text)) continue;
    const parts = text.split(/\s-\s/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    matches.push({ href, text, homeTeam: parts[0], awayTeam: parts[1] });
  }
  return matches;
}

export async function searchFlashscoreMatch({ homeTeam, awayTeam, sport = "football", tournament = "", headless = true, timeoutMs = 45000 }) {
  const urls = programUrlsByTournament(sport, tournament);
  let best = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) continue;
      const html = await response.text();
      const candidates = extractMatchAnchors(html);
      for (const cand of candidates) {
        const s = scoreMatch(homeTeam, awayTeam, cand.homeTeam, cand.awayTeam);
        if (!best || s > best.score) {
          best = {
            score: s,
            homeTeam: cand.homeTeam,
            awayTeam: cand.awayTeam,
            href: cand.href.startsWith("http") ? cand.href : `${FLASHSCORE_BASE}${cand.href}`,
            sourceUrl: url
          };
        }
      }
    } catch {
      // try next url
    }
  }
  if (!best || best.score < 140) return null;
  return { homeTeam: best.homeTeam, awayTeam: best.awayTeam, confidence: best.score, href: best.href, sourceUrl: best.sourceUrl };
}

function normalizeMatchUrl(matchUrl = "") {
  const normalizedUrl = (matchUrl || "").trim();
  if (!normalizedUrl) throw new Error("matchUrl is required");
  let url = normalizedUrl;
  if (!/^https?:\/\//i.test(url)) {
    url = url.startsWith("/") ? FLASHSCORE_BASE + url : FLASHSCORE_BASE + "/" + url;
  }
  if (!/\/kurzy\b/.test(url)) url = url.replace(/\/$/, "") + "/kurzy";
  return url;
}

function normalizeHeaderToken(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isExactOrderedLabelSet(labels = [], expected = []) {
  if (!Array.isArray(labels) || !Array.isArray(expected)) return false;
  if (labels.length !== expected.length) return false;
  return labels.every((label, idx) => normalizeHeaderToken(label) === normalizeHeaderToken(expected[idx]));
}

export function isSafeDoubleChanceLabels(labels = []) {
  return isExactOrderedLabelSet(labels, ["1x", "12", "x2"]);
}

export function isSafeMatchWinner2WayLabels(labels = []) {
  return isExactOrderedLabelSet(labels, ["1", "2"]);
}

function parseLineValue(value = "") {
  const text = String(value || "").trim();
  if (!text) return null;
  const num = text.match(/[-+]?\d+(?:[.,]\d+)?/);
  if (!num) return null;
  const parsed = Number(num[0].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLineFromRow(rawRowText = "", oddTexts = []) {
  const normalizedRaw = String(rawRowText || "")
    .replace(/[^\d+,\-.]/g, "")
    .trim();
  const normalizedOdds = oddTexts.map((x) => String(x || "").replace(",", "."));
  const oddsSuffix = normalizedOdds.join("");
  let candidate = normalizedRaw;
  if (oddsSuffix && normalizedRaw.endsWith(oddsSuffix) && normalizedRaw.length > oddsSuffix.length) {
    candidate = normalizedRaw.slice(0, -oddsSuffix.length);
  }
  const matches = candidate.match(/[-+]?\d+(?:[.,]\d+)?/g);
  if (!matches || !matches.length) return null;
  // In merged-line formats (-2,-2.5), keep the last captured line token.
  return parseLineValue(matches[matches.length - 1]);
}

async function scrapeFlashscoreMarketTable({
  matchUrl,
  tabRegex,
  marketType,
  marketName,
  expectedLabels = [],
  labelAliases = {},
  requireExactLabelSet = false,
  expectedOddCount,
  requireLine = false,
  headless = true,
  timeoutMs = 45000
}) {
  const url = normalizeMatchUrl(matchUrl);
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT, userAgent: DEFAULT_UA });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await delay(2500);
    await page.getByText(tabRegex).first().click({ timeout: 4500 }).catch(() => {});
    await delay(1200);
    await page.getByText(/ZÁKLADNÝ ČAS|FULL TIME/i).first().click({ timeout: 2000 }).catch(() => {});
    await delay(1200);

    const table = await page.evaluate(() => {
      const clean = (v) => (v || "").replace(/\s+/g, " ").trim();
      const labels = Array.from(document.querySelectorAll(".ui-table__header .oddsCell__header"))
        .map((el) => clean(el.textContent))
        .filter(Boolean);
      const activeHints = Array.from(document.querySelectorAll("*"))
        .filter((el) => /active|selected|current/i.test(el.className || ""))
        .map((el) => clean(el.textContent))
        .filter(Boolean)
        .slice(0, 25);
      const rows = Array.from(document.querySelectorAll(".ui-table__row")).map((row) => {
        const bookmakerAnchor = row.querySelector(".wcl-bookmakerLogo_4IUU0 a[title]");
        const bookmaker = clean(bookmakerAnchor?.getAttribute("title") || bookmakerAnchor?.textContent || "");
        const bookmakerId = clean(row.querySelector("[data-analytics-bookmaker-id]")?.getAttribute("data-analytics-bookmaker-id") || "");
        const oddNodes = Array.from(row.querySelectorAll(".oddsCell__odd"));
        const oddTexts = oddNodes.map((n) => clean(n.textContent));
        const lineText = clean(row.querySelector(".oddsCell__noOddsCell, .oddsCell__line")?.textContent || "");
        return {
          bookmaker,
          bookmakerId,
          oddTexts,
          lineText,
          rawRowText: clean(row.textContent)
        };
      }).filter((r) => r.bookmaker && r.oddTexts.length >= 2);

      return { labels, activeHints, rows };
    });

    const canonicalLabels = [...new Set(
      table.labels
        .map((x) => normalizeHeaderToken(x))
        .map((x) => labelAliases[x] || x)
        .filter(Boolean)
    )];
    if (expectedLabels.length) {
      const expected = expectedLabels.map((x) => normalizeHeaderToken(x));
      const hasExpected = expected.every((x) => canonicalLabels.includes(x));
      if (!hasExpected) {
        return {
          marketType,
          marketName,
          period: "full_time",
          periodName: "Základný čas",
          matchUrl: url,
          columnLabels: canonicalLabels,
          activeHints: table.activeHints,
          bookmakerRows: []
        };
      }
      if (requireExactLabelSet && (canonicalLabels.length !== expected.length || !canonicalLabels.every((x, idx) => x === expected[idx]))) {
        return {
          marketType,
          marketName,
          period: "full_time",
          periodName: "Základný čas",
          matchUrl: url,
          columnLabels: canonicalLabels,
          activeHints: table.activeHints,
          bookmakerRows: []
        };
      }
    }

    const parsedRows = table.rows.map((row) => {
      const parsedOdds = row.oddTexts
        .map((v) => parseOdd(v, { rejectDateLike: false }))
        .filter((x) => x !== null);
      const lineValue = requireLine ? (parseLineValue(row.lineText) ?? parseLineFromRow(row.rawRowText, row.oddTexts)) : null;
      const normalized = {
        bookmaker: row.bookmaker,
        bookmakerId: row.bookmakerId || null,
        line: lineValue,
        lineRaw: row.lineText || "",
        extractedOddsArray: parsedOdds,
        rawRowText: row.rawRowText
      };
      return normalized;
    }).filter((row) => {
      if (expectedOddCount != null && row.extractedOddsArray.length !== expectedOddCount) return false;
      if (requireLine && row.line == null) return false;
      return true;
    });

    return {
      marketType,
      marketName,
      period: "full_time",
      periodName: "Základný čas",
      matchUrl: url,
      columnLabels: canonicalLabels,
      activeHints: table.activeHints,
      bookmakerRows: parsedRows
    };
  } finally {
    await browser.close();
  }
}

function mapDcRows(rows = []) {
  const dcRange = (o) => o != null && o >= 1.05 && o <= 4.5;
  return rows
    .map((row) => ({
      ...row,
      selectionOdds: {
        "1x": row.extractedOddsArray[0] ?? null,
        "12": row.extractedOddsArray[1] ?? null,
        "x2": row.extractedOddsArray[2] ?? null
      }
    }))
    .filter((row) => dcRange(row.selectionOdds["1x"]) && dcRange(row.selectionOdds["12"]) && dcRange(row.selectionOdds["x2"]));
}

function mapTwoWayRows(rows = [], leftKey, rightKey, minOdd = 1.01, maxOdd = 20) {
  return rows
    .map((row) => ({
      ...row,
      selectionOdds: {
        [leftKey]: row.extractedOddsArray[0] ?? null,
        [rightKey]: row.extractedOddsArray[1] ?? null
      }
    }))
    .filter((row) => {
      const a = row.selectionOdds[leftKey];
      const b = row.selectionOdds[rightKey];
      return a != null && b != null && a >= minOdd && a <= maxOdd && b >= minOdd && b <= maxOdd;
    });
}

function keepFirstPerBookmaker(rows = []) {
  const result = [];
  const seen = new Set();
  for (const row of rows) {
    const key = normalizeHeaderToken(row.bookmaker);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

export async function scrapeFlashscoreDoubleChance({ matchUrl, headless = true, timeoutMs = 45000 }) {
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    tabRegex: /DVOJITÁ ŠANCA|DOUBLE CHANCE/i,
    marketType: "double_chance",
    marketName: "Dvojitá šanca",
    expectedLabels: ["1x", "12", "x2"],
    labelAliases: { "1x": "1x", "12": "12", "x2": "x2" },
    requireExactLabelSet: true,
    expectedOddCount: 3,
    requireLine: false,
    headless,
    timeoutMs
  });
  return {
    ...base,
    columnLabels: base.columnLabels.map((x) => x.toUpperCase()),
    bookmakerRows: keepFirstPerBookmaker(mapDcRows(base.bookmakerRows))
  };
}

export async function scrapeFlashscoreTipsportWinner2Way({ matchUrl, headless = true, timeoutMs = 45000 }) {
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    tabRegex: /1X2|VÍŤAZ ZÁPASU|MATCH WINNER/i,
    marketType: "match_winner_2way",
    marketName: "Víťaz zápasu 2-way",
    expectedLabels: ["1", "2"],
    labelAliases: { "1": "1", "2": "2", "home": "1", "away": "2" },
    requireExactLabelSet: true,
    expectedOddCount: 2,
    requireLine: false,
    headless,
    timeoutMs
  });
  return {
    ...base,
    bookmakerRows: keepFirstPerBookmaker(mapTwoWayRows(base.bookmakerRows, "home", "away", 1.01, 20))
  };
}

export async function scrapeFlashscoreOverUnder2Way({ matchUrl, headless = true, timeoutMs = 45000 }) {
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    tabRegex: /OVER\/UNDER|OVER UNDER/i,
    marketType: "over_under_2way",
    marketName: "Over/Under",
    expectedLabels: ["over", "under"],
    labelAliases: { over: "over", under: "under", "o/u": "over" },
    requireExactLabelSet: false,
    expectedOddCount: 2,
    requireLine: true,
    headless,
    timeoutMs
  });
  return {
    ...base,
    bookmakerRows: keepFirstPerBookmaker(mapTwoWayRows(base.bookmakerRows, "over", "under", 1.01, 20))
  };
}

export async function scrapeFlashscoreAsianHandicap2Way({ matchUrl, headless = true, timeoutMs = 45000 }) {
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    tabRegex: /ÁZIJSKÝ HANDICAP|AZIJSK[YÝ] HANDICAP|ASIAN HANDICAP/i,
    marketType: "asian_handicap_2way",
    marketName: "Ázijský handicap",
    expectedLabels: ["1", "2"],
    labelAliases: { "1": "1", "2": "2", home: "1", away: "2" },
    requireExactLabelSet: false,
    expectedOddCount: 2,
    requireLine: true,
    headless,
    timeoutMs
  });
  return {
    ...base,
    bookmakerRows: keepFirstPerBookmaker(mapTwoWayRows(base.bookmakerRows, "home", "away", 1.01, 20))
  };
}

export async function scrapeFlashscoreBttsYesNo({ matchUrl, headless = true, timeoutMs = 45000 }) {
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    tabRegex: /OBAJA DAJ[ÚU] G[ÓO]L|BOTH TEAMS TO SCORE/i,
    marketType: "both_teams_to_score",
    marketName: "Obaja dajú gól",
    expectedLabels: ["yes", "no"],
    labelAliases: { ano: "yes", áno: "yes", yes: "yes", nie: "no", no: "no" },
    requireExactLabelSet: false,
    expectedOddCount: 2,
    requireLine: false,
    headless,
    timeoutMs
  });
  return {
    ...base,
    bookmakerRows: keepFirstPerBookmaker(mapTwoWayRows(base.bookmakerRows, "yes", "no", 1.01, 20))
  };
}

export async function scrapeFlashscoreDrawNoBet2Way({ matchUrl, headless = true, timeoutMs = 45000 }) {
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    tabRegex: /ST[ÁA]VKA BEZ REM[ÍI]ZY|DRAW NO BET/i,
    marketType: "draw_no_bet_2way",
    marketName: "Stávka bez remízy",
    expectedLabels: ["1", "2"],
    labelAliases: { "1": "1", "2": "2", home: "1", away: "2" },
    requireExactLabelSet: false,
    expectedOddCount: 2,
    requireLine: false,
    headless,
    timeoutMs
  });
  return {
    ...base,
    bookmakerRows: keepFirstPerBookmaker(mapTwoWayRows(base.bookmakerRows, "home", "away", 1.01, 20))
  };
}

export async function scrapeFlashscoreEuropeanHandicap2Way({ matchUrl, headless = true, timeoutMs = 45000 }) {
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    tabRegex: /EUR[ÓO]PSKY HANDICAP|EUROPEAN HANDICAP/i,
    marketType: "european_handicap_2way",
    marketName: "Európsky handicap",
    expectedLabels: ["handicap", "1", "2"],
    labelAliases: { "1": "1", "2": "2", home: "1", away: "2" },
    requireExactLabelSet: true,
    expectedOddCount: 2,
    requireLine: true,
    headless,
    timeoutMs
  });
  return {
    ...base,
    bookmakerRows: keepFirstPerBookmaker(mapTwoWayRows(base.bookmakerRows, "home", "away", 1.01, 20))
  };
}

export async function scrapeFlashscoreGenericYesNo({ matchUrl, tabRegex, marketName = "Yes/No", headless = true, timeoutMs = 45000 }) {
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    tabRegex,
    marketType: "generic_yes_no",
    marketName,
    expectedLabels: ["yes", "no"],
    labelAliases: { ano: "yes", áno: "yes", yes: "yes", nie: "no", no: "no" },
    requireExactLabelSet: false,
    expectedOddCount: 2,
    requireLine: false,
    headless,
    timeoutMs
  });
  return {
    ...base,
    bookmakerRows: keepFirstPerBookmaker(mapTwoWayRows(base.bookmakerRows, "yes", "no", 1.01, 20))
  };
}

/*
 * Backward-compatible wrapper kept for existing callers.
 */
export async function scrapeFlashscoreMarketByType({ matchUrl, marketType, headless = true, timeoutMs = 45000 }) {
  switch (marketType) {
    case "double_chance":
      return scrapeFlashscoreDoubleChance({ matchUrl, headless, timeoutMs });
    case "match_winner_2way":
      return scrapeFlashscoreTipsportWinner2Way({ matchUrl, headless, timeoutMs });
    case "over_under_2way":
      return scrapeFlashscoreOverUnder2Way({ matchUrl, headless, timeoutMs });
    case "asian_handicap_2way":
      return scrapeFlashscoreAsianHandicap2Way({ matchUrl, headless, timeoutMs });
    case "both_teams_to_score":
      return scrapeFlashscoreBttsYesNo({ matchUrl, headless, timeoutMs });
    case "draw_no_bet_2way":
      return scrapeFlashscoreDrawNoBet2Way({ matchUrl, headless, timeoutMs });
    case "european_handicap_2way":
      return scrapeFlashscoreEuropeanHandicap2Way({ matchUrl, headless, timeoutMs });
    default:
      {
      const normalized = normalizeMatchUrl(matchUrl);
      return {
        marketType,
        marketName: "Unsupported",
        period: "full_time",
        periodName: "Základný čas",
        matchUrl: normalized,
        columnLabels: [],
        activeHints: [],
        bookmakerRows: []
      };
      }
  }
}
