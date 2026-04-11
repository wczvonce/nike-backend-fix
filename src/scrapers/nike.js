import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeTeamName, parseOdd } from "../utils/normalize.js";
import { delay } from "../utils/delay.js";
import { normalizeForCompare } from "../utils/pipeline-logic.js";

const NIKE_MOBILE_URLS = [
  "https://m.nike.sk/tipovanie/superkurzy",
  "https://m.nike.sk/tipovanie"
];
const NIKE_DESKTOP_URLS = [
  "https://www.nike.sk/tipovanie/superkurzy",
  "https://www.nike.sk/tipovanie"
];
const NIKE_SITE_MODE = String(process.env.NIKE_SITE_MODE || "mobile").toLowerCase();
const DC_SELECTIONS = ["1x", "12", "x2"];

function detectSportFromText(value = "") {
  const t = String(value || "").toLowerCase();
  if (t.includes("futbal") || t.includes("football") || t.includes("liga na dedine")) return "football";
  if (t.includes("hokej") || t.includes("hockey") || t.includes("erste liga")) return "hockey";
  if (t.includes("tenis") || t.includes("tennis") || t.includes("wta") || t.includes("atp")) return "tennis";
  if (t.includes("basketbal") || t.includes("basketball") || t.includes("nba") || t.includes("bc ") || /\bbc\s/.test(t) || t.includes("euroliga") || t.includes("euroleague")) return "basketball";
  if (t.includes("hádzan") || t.includes("handbal") || t.includes("handball") || t.includes("ehf")) return "handball";
  if (t.includes("volejbal") || t.includes("volleyball") || t.includes("extraliga mu") || /polo\s/i.test(t)) return "volleyball";
  return "unknown";
}

function splitParticipants(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return { homeTeam: "", awayTeam: "" };
  const parts = raw.split(/\s+(?:vs|v\.?)\s+|\s+-\s+/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { homeTeam: parts[0], awayTeam: parts[1] };
  return { homeTeam: raw, awayTeam: "" };
}

function normalizeMatchLabel(rawTitle = "") {
  const parts = String(rawTitle || "").split(/\s+vs\s+/i).map((x) => x.trim());
  if (parts.length >= 2) {
    return `${normalizeTeamName(parts[0])}__${normalizeTeamName(parts[1])}`;
  }
  const split = splitParticipants(rawTitle);
  return `${normalizeTeamName(split.homeTeam)}__${normalizeTeamName(split.awayTeam)}`;
}

// validateSuperponukaMatches removed — validation moved to server.js validateSuperkurzy()

async function acceptCookies(page) {
  const selectors = [
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept",
    "button:has-text('Súhlasím')",
    "button:has-text('Prijať všetko')",
    "button:has-text('Akceptovať')",
    "button:has-text('Accept')"
  ];
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.count()) {
        await el.click({ timeout: 800 });
        await delay(500);
      }
    } catch {
      // ignored
    }
  }
}

function getNikeUrls(siteMode = NIKE_SITE_MODE) {
  if (siteMode === "desktop") return [...NIKE_DESKTOP_URLS, ...NIKE_MOBILE_URLS];
  if (siteMode === "mobile") return [...NIKE_MOBILE_URLS, ...NIKE_DESKTOP_URLS];
  return [...NIKE_MOBILE_URLS, ...NIKE_DESKTOP_URLS];
}

async function openNikePage(page, timeoutMs, siteMode = NIKE_SITE_MODE) {
  let lastError = null;
  for (const url of getNikeUrls(siteMode)) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      return page.url();
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Nike page failed to load: ${lastError?.message || "unknown error"}`);
}

function buildMarketsFromCardOdds(matches) {
  const markets = [];
  const dcRange = (o) => o >= 1.05 && o <= 6.0;
  for (const match of matches) {
    const odds = match.rawOdds;
    if (match.sport === "tennis") {
      if (odds.length >= 2) {
        markets.push({ id: `${match.id}-winner-home`, matchId: match.id, marketType: "match_winner_2way", period: "full_time", line: null, selection: "home", nikeOdd: odds[0] });
        markets.push({ id: `${match.id}-winner-away`, matchId: match.id, marketType: "match_winner_2way", period: "full_time", line: null, selection: "away", nikeOdd: odds[1] });
      }
      continue;
    }
    if (match.sport === "basketball") {
      // Basketball has no draws – emit 2-way winner, not double chance.
      if (odds.length >= 2) {
        markets.push({ id: `${match.id}-winner-home`, matchId: match.id, marketType: "match_winner_2way", period: "full_time", line: null, selection: "home", nikeOdd: odds[0] });
        markets.push({ id: `${match.id}-winner-away`, matchId: match.id, marketType: "match_winner_2way", period: "full_time", line: null, selection: "away", nikeOdd: odds[1] });
      }
      continue;
    }
    let dc1x = null;
    let dc12 = null;
    let dcx2 = null;
    if (odds.length >= 6 && dcRange(odds[3]) && dcRange(odds[4]) && dcRange(odds[5])) {
      dc1x = odds[3];
      dc12 = odds[4];
      dcx2 = odds[5];
    } else if (odds.length >= 3) {
      const last3 = odds.slice(-3);
      if (last3.every(dcRange)) {
        dc1x = last3[0];
        dc12 = last3[1];
        dcx2 = last3[2];
      }
    }
    if (dc1x != null && dc12 != null && dcx2 != null) {
      markets.push({ id: `${match.id}-dc-1x`, matchId: match.id, marketType: "double_chance", period: "full_time", line: null, selection: DC_SELECTIONS[0], nikeOdd: dc1x });
      markets.push({ id: `${match.id}-dc-12`, matchId: match.id, marketType: "double_chance", period: "full_time", line: null, selection: DC_SELECTIONS[1], nikeOdd: dc12 });
      markets.push({ id: `${match.id}-dc-x2`, matchId: match.id, marketType: "double_chance", period: "full_time", line: null, selection: DC_SELECTIONS[2], nikeOdd: dcx2 });
    }
  }
  return markets;
}

function parseLineToken(value = "") {
  const m = String(value || "").match(/[+-]?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const num = Number(m[0].replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function sanitizeLine(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const num = Number(value);
  const snappedHalf = Math.round(num * 2) / 2;
  if (Math.abs(num - snappedHalf) <= 0.11) return Number(snappedHalf.toFixed(2));
  return Number(num.toFixed(2));
}

function parsePeriodFromMarketName(marketName = "") {
  const n = normalizeForCompare(marketName);
  if (/prv[ýy]\s*set/.test(n)) return "first_set";
  if (/druh[ýy]\s*set/.test(n)) return "second_set";
  if (/^1\s*\.?\s*set|v 1\.?\s*sete|1\.?\s*set/.test(n)) return "first_set";
  if (/^2\s*\.?\s*set|v 2\.?\s*sete|2\.?\s*set/.test(n)) return "second_set";
  if (/^1\s*\.?\s*polcas|v 1\.?\s*polcase|1\.?\s*polcas/.test(n)) return "first_half";
  if (/^2\s*\.?\s*polcas|v 2\.?\s*polcase|2\.?\s*polcas/.test(n)) return "second_half";
  return "full_time";
}

function pushMarket(markets, row) {
  if (row.nikeOdd == null || !Number.isFinite(row.nikeOdd)) return;
  markets.push(row);
}

function parseNikeDetailMarketsForMatch(match, detailMarkets = []) {
  const markets = [];
  const homeKey = normalizeForCompare(match.homeTeam || "").split(" ").filter(Boolean)[0] || "";
  const awayKey = normalizeForCompare(match.awayTeam || "").split(" ").filter(Boolean)[0] || "";
  for (const market of detailMarkets) {
    const marketName = String(market.marketName || "").trim();
    if (!marketName) continue;
    const normalizedName = normalizeForCompare(marketName);
    const period = parsePeriodFromMarketName(marketName);
    if (!["full_time", "first_set", "second_set"].includes(period)) continue;
    const rows = Array.isArray(market.rows) ? market.rows : [];

    // Zápas can contain 1X2 + double chance, or 2-way winner depending on sport.
    const isPureSetWinnerMarket = /^([12]\s*\.?\s*set|prv[ýy]\s*set|druh[ýy]\s*set)$/.test(normalizedName);
    if (
      normalizedName === "zapas" ||
      normalizedName === "vitaz zapasu" ||
      isPureSetWinnerMarket
    ) {
      for (const row of rows) {
        const odds = (row.odds || []).map((v) => parseOdd(v, { rejectDateLike: false, rejectTimeLike: false })).filter((v) => v !== null);
        const hasDraw = normalizeForCompare(row.text || "").includes("remiza");
        if (odds.length >= 6 && hasDraw) {
          const dc = odds.slice(-3);
          if (dc.length === 3 && dc.every((o) => o >= 1.05 && o <= 6.0)) {
            pushMarket(markets, { id: `${match.id}-dc-1x`, matchId: match.id, marketType: "double_chance", period, line: null, selection: "1x", nikeOdd: dc[0] });
            pushMarket(markets, { id: `${match.id}-dc-12`, matchId: match.id, marketType: "double_chance", period, line: null, selection: "12", nikeOdd: dc[1] });
            pushMarket(markets, { id: `${match.id}-dc-x2`, matchId: match.id, marketType: "double_chance", period, line: null, selection: "x2", nikeOdd: dc[2] });
          }
        } else if (odds.length >= 2 && !hasDraw) {
          pushMarket(markets, { id: `${match.id}-winner-home`, matchId: match.id, marketType: "match_winner_2way", period, line: null, selection: "home", nikeOdd: odds[0] });
          pushMarket(markets, { id: `${match.id}-winner-away`, matchId: match.id, marketType: "match_winner_2way", period, line: null, selection: "away", nikeOdd: odds[1] });
        }
      }
      continue;
    }

    if (normalizedName.includes("stavka bez remizy")) {
      // DNB has only one row (no line). If Nike shows multiple rows under "Stávka bez remízy",
      // the extra rows are european handicap lines — only take the first valid row.
      for (const row of rows) {
        const odds = (row.odds || []).map((v) => parseOdd(v, { rejectDateLike: false, rejectTimeLike: false })).filter((v) => v !== null);
        if (odds.length < 2) continue;
        pushMarket(markets, { id: `${match.id}-dnb-home`, matchId: match.id, marketType: "draw_no_bet_2way", period, line: null, selection: "home", nikeOdd: odds[0] });
        pushMarket(markets, { id: `${match.id}-dnb-away`, matchId: match.id, marketType: "draw_no_bet_2way", period, line: null, selection: "away", nikeOdd: odds[1] });
        break; // only first row is actual DNB
      }
      continue;
    }

    if (normalizedName === "obaja daju gol") {
      for (const row of rows) {
        const odds = (row.odds || []).map((v) => parseOdd(v, { rejectDateLike: false, rejectTimeLike: false })).filter((v) => v !== null);
        if (odds.length < 2) continue;
        pushMarket(markets, { id: `${match.id}-btts-yes`, matchId: match.id, marketType: "both_teams_to_score", period, line: null, selection: "yes", nikeOdd: odds[0] });
        pushMarket(markets, { id: `${match.id}-btts-no`, matchId: match.id, marketType: "both_teams_to_score", period, line: null, selection: "no", nikeOdd: odds[1] });
      }
      continue;
    }

    if (
      normalizedName === "handicap" ||
      normalizedName === "handicap gemy" ||
      normalizedName.endsWith("handicap gemy")
    ) {
      for (const row of rows) {
        const odds = (row.odds || []).map((v) => parseOdd(v, { rejectDateLike: false, rejectTimeLike: false })).filter((v) => v !== null);
        // Extract signed handicap lines from text in ORIGINAL order (not sorted/deduped).
        const rawLines = [...String(row.text || "").matchAll(/([+-]\d+(?:[.,]\d+)?)/g)]
          .map((m) => sanitizeLine(parseLineToken(m[1])))
          .filter((x) => x != null);
        const pairs = Math.floor(odds.length / 2);
        if (pairs === 0) continue;

        // Build line-to-pair mapping: each pair of odds needs exactly one line.
        // Strategy: use original text order. Each line token in rawLines maps
        // to the next odds pair. Reject row if line count !== pair count.
        // Also reject split/quarter lines (already filtered by sanitizeLine).
        // Deduplicate adjacent identical lines (e.g. "+1.5 +1.5" from repeated text).
        const pairLines = [];
        let prev = null;
        for (const l of rawLines) {
          if (l === prev) continue; // skip adjacent duplicates
          pairLines.push(Math.abs(l));
          prev = l;
        }
        // Strict: line count must exactly match pair count
        if (pairLines.length !== pairs) continue;

        for (let i = 0; i < pairs; i++) {
          const line = sanitizeLine(pairLines[i]);
          if (line == null) continue;
          const homeOdd = odds[i * 2];
          const awayOdd = odds[i * 2 + 1];
          pushMarket(markets, { id: `${match.id}-ah-home-${line}-${i}`, matchId: match.id, marketType: "asian_handicap_2way", period, line, selection: "home", nikeOdd: homeOdd });
          pushMarket(markets, { id: `${match.id}-ah-away-${line}-${i}`, matchId: match.id, marketType: "asian_handicap_2way", period, line, selection: "away", nikeOdd: awayOdd });
        }
      }
      continue;
    }

    const isMatchGoalsTotal = normalizedName === "pocet golov v zapase";
    const isMatchGamesTotal = normalizedName === "pocet gemov";
    const isPlayerScopedTotal =
      (homeKey && normalizedName.includes(homeKey)) ||
      (awayKey && normalizedName.includes(awayKey));
    if ((isMatchGoalsTotal || isMatchGamesTotal) && !isPlayerScopedTotal) {
      for (const row of rows) {
        const odds = (row.odds || []).map((v) => parseOdd(v, { rejectDateLike: false, rejectTimeLike: false })).filter((v) => v !== null);
        const rowText = normalizeForCompare(row.text || "");
        const lineTokens = [...String(row.text || "").matchAll(/menej ako\s*(\d+(?:[.,](?:0|5))?)/gi)]
          .map((m) => sanitizeLine(parseLineToken(m[1])))
          .filter((x) => x != null);
        // Detect if "viac" (over) appears before "menej" (under) in text → odds may be over-first
        const viacPos = rowText.indexOf("viac");
        const menejPos = rowText.indexOf("menej");
        const overFirst = viacPos >= 0 && menejPos >= 0 && viacPos < menejPos;
        const pairs = Math.floor(odds.length / 2);
        for (let i = 0; i < pairs; i++) {
          const line = sanitizeLine(lineTokens[i] ?? null);
          if (line == null) continue;
          // Default: Nike "menej ako X" shows [UNDER, OVER].
          // If "viac" appears before "menej" in text, order is [OVER, UNDER].
          let underOdd = odds[i * 2];
          let overOdd = odds[i * 2 + 1];
          if (overFirst) {
            overOdd = odds[i * 2];
            underOdd = odds[i * 2 + 1];
          }
          pushMarket(markets, { id: `${match.id}-ou-under-${line}-${i}`, matchId: match.id, marketType: "over_under_2way", period, line, selection: "under", nikeOdd: underOdd });
          pushMarket(markets, { id: `${match.id}-ou-over-${line}-${i}`, matchId: match.id, marketType: "over_under_2way", period, line, selection: "over", nikeOdd: overOdd });
        }
      }
    }
  }
  return markets;
}

function dedupeMarkets(markets = []) {
  const result = [];
  const seen = new Set();
  for (const m of markets) {
    // For non-line markets (DNB, DC, winner, BTTS), deduplicate by matchId+type+period+selection
    // to keep only the FIRST occurrence (most reliable). Including nikeOdd in the key would
    // allow duplicates with different odds from different Nike detail sections.
    // Dedupe by logical market identity only — never include nikeOdd in the key.
    // Including nikeOdd allows duplicates with different odds from fallback vs detail scrape.
    const isLineMarket = ["asian_handicap_2way", "over_under_2way", "european_handicap_2way"].includes(m.marketType);
    const key = isLineMarket
      ? [m.matchId, m.marketType, m.period || "full_time", m.line ?? "null", m.selection].join("|")
      : [m.matchId, m.marketType, m.period || "full_time", m.selection].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(m);
  }
  return result;
}

async function scrapeNikeCore({ headless = true, timeoutMs = 45000, saveDebugArtifacts = false, siteMode = NIKE_SITE_MODE } = {}) {
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 2200 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();
    await openNikePage(page, timeoutMs, siteMode);
    await acceptCookies(page);
    await delay(4000);

    if (saveDebugArtifacts) {
      const debugDir = path.resolve("debug");
      await fs.mkdir(debugDir, { recursive: true });
      await fs.writeFile(path.join(debugDir, "nike-page.html"), await page.content(), "utf8");
      await fs.writeFile(path.join(debugDir, "nike-page.txt"), await page.evaluate(() => document.body?.innerText || ""), "utf8");
      await page.screenshot({ path: path.join(debugDir, "nike-page.png"), fullPage: true });
    }

    const extracted = await page.evaluate(() => {
      const clean = (v) => (v || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      const bodyText = (document.body?.innerText || "").replace(/\u00a0/g, " ");
      const firstLines = bodyText.split("\n").map((line) => clean(line)).filter(Boolean).slice(0, 120);

      const rows = Array.from(document.querySelectorAll("[data-game-state]"))
        .filter((row) => row.querySelector('[data-atid="bets-opponents"]'));
      const detectSectionForRow = (row, rowEl) => {
        // Primary: reliable detection via ancestor container data-atid attribute
        // Nike HTML structure: <div data-atid="superoffer"> wraps Superponuka,
        //                      <div data-atid="superchance"> wraps Superšanca
        const el = row || rowEl;
        if (el?.closest?.('[data-atid="superchance"]')) return "super_sanca";
        if (el?.closest?.('[data-atid="superoffer"]')) return "super_ponuka";
        // Secondary: check title attributes which contain "Superšanca | date | ..."
        const titleText = clean(
          row?.getAttribute?.("title") || rowEl?.getAttribute?.("title") ||
          row?.querySelector?.("[title]")?.getAttribute?.("title") || ""
        ).toLowerCase();
        if (/super\s*š?anca|supersanca/i.test(titleText)) return "super_sanca";
        if (/superponuka/i.test(titleText)) return "super_ponuka";
        // Tertiary: data-tournament attribute on ancestor bet-group-view
        const betGroupEl = el?.closest?.('[data-atid="bet-group-view"]');
        const dataTournament = clean(betGroupEl?.getAttribute?.("data-tournament") || betGroupEl?.closest?.("[data-tournament]")?.getAttribute?.("data-tournament") || "");
        if (/super\s*š?anca|supersanca/i.test(dataTournament)) return "super_sanca";
        // Fallback: scan sibling elements for section headers
        let cursor = row;
        for (let i = 0; i < 12 && cursor; i++) {
          cursor = cursor.previousElementSibling;
          const siblingText = clean(cursor?.textContent || "").toLowerCase();
          if (!siblingText) continue;
          if (/super\s*š?anca|supersanca/i.test(siblingText)) return "super_sanca";
          if (/super\s*ponuka|superponuka/i.test(siblingText)) return "super_ponuka";
        }
        return "super_ponuka";
      };
      const candidateCards = [];
      let currentDateParts = null;
      for (const row of rows) {
        const btn = row.querySelector('[data-atid="bets-opponents"]');
        if (!btn) continue;
        const rowEl = btn.closest("[data-game-state]") || btn.closest("li") || btn.parentElement?.parentElement || btn.parentElement;
        const section = detectSectionForRow(row, rowEl);
        let cursor = row;
        for (let i = 0; i < 8 && cursor; i++) {
          cursor = cursor.previousElementSibling;
          const siblingText = clean(cursor?.textContent || "");
          const dateInSibling = siblingText.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
          if (dateInSibling) {
            currentDateParts = { d: dateInSibling[1], m: dateInSibling[2], y: dateInSibling[3] };
            break;
          }
        }
        const oddEls = rowEl ? Array.from(rowEl.querySelectorAll('[data-atid$="bet-odd"], [data-atid*="bet-odd"]')) : [];
        const odds = oddEls.map((el) => clean(el.textContent)).filter(Boolean);

        const divParts = Array.from(btn.querySelectorAll("div")).map((d) => clean(d.textContent)).filter((x) => x && !/^vs$/i.test(x));
        const participantsAttr = clean(btn.getAttribute("data-participants") || btn.getAttribute("title") || "");
        const participants = participantsAttr || clean(btn.textContent || "");
        const homeTeam = divParts[0] || "";
        const awayTeam = divParts[1] || "";
        const metaTitle = clean(
          rowEl?.getAttribute("title") ||
          btn.getAttribute("title") ||
          rowEl?.querySelector("[title]")?.getAttribute("title") ||
          ""
        );
        const rowSnippet = clean(rowEl?.textContent || "").slice(0, 500);
        let dateMatch = metaTitle.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
        if (!dateMatch && rowSnippet) {
          dateMatch = rowSnippet.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
          if (!dateMatch) dateMatch = rowSnippet.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s+(\d{2}):(\d{2})/);
        }
        let kickoffAt = null;
        if (dateMatch && dateMatch.length >= 6) {
          kickoffAt = `${dateMatch[3]}-${String(dateMatch[2]).padStart(2, "0")}-${String(dateMatch[1]).padStart(2, "0")}T${dateMatch[4]}:${dateMatch[5]}:00`;
        } else {
          const timeMatch = (rowSnippet || metaTitle).match(/\b(\d{1,2}):(\d{2})\b/);
          if (currentDateParts && timeMatch) {
            const d = String(currentDateParts.d).padStart(2, "0");
            const m = String(currentDateParts.m).padStart(2, "0");
            const h = String(timeMatch[1]).padStart(2, "0");
            const min = String(timeMatch[2]).padStart(2, "0");
            kickoffAt = `${currentDateParts.y}-${m}-${d}T${h}:${min}:00`;
          }
        }

        candidateCards.push({
          section,
          sport: clean(btn.getAttribute("data-sport") || rowEl?.querySelector("[data-sport]")?.getAttribute("data-sport") || ""),
          tournament: clean(btn.getAttribute("data-tournament") || ""),
          participants,
          homeTeam,
          awayTeam,
          kickoffAt,
          metaTitle,
          odds,
          rowSnippet
        });
        if (candidateCards.length > 80) break;
      }

      return {
        title: document.title,
        finalUrl: location.href,
        firstLines,
        candidateCards
      };
    });

    const matches = [];
    const seenMatches = new Set();
    let matchId = 1;
    for (const card of extracted.candidateCards) {
      const teams = card.homeTeam && card.awayTeam
        ? { homeTeam: card.homeTeam, awayTeam: card.awayTeam }
        : splitParticipants(card.participants);
      const homeTeam = teams.homeTeam?.trim();
      const awayTeam = teams.awayTeam?.trim();
      // IMPORTANT: Do NOT dedup/Set parsedOdds — order is positional (1X2 + DC mapping).
      // Duplicate values (e.g. two odds of 1.85) are valid and must be preserved.
      const parsedOdds = card.odds.map((v) => parseOdd(v, { rejectDateLike: false, rejectTimeLike: false })).filter((v) => v !== null);
      if (!homeTeam || !awayTeam || parsedOdds.length < 2) continue;
      const dedupKey = `${normalizeTeamName(homeTeam)}__${normalizeTeamName(awayTeam)}__${card.tournament || ""}`;
      if (seenMatches.has(dedupKey)) continue;
      seenMatches.add(dedupKey);
      matches.push({
        id: `nike-${matchId++}`,
        source: "nike",
        section: card.section || "super_ponuka",
        sport: detectSportFromText(card.sport || card.tournament || card.rowSnippet || ""),
        tournament: card.tournament || null,
        kickoffAt: card.kickoffAt || null,
        rawTitle: `${homeTeam} vs ${awayTeam}`,
        homeTeam,
        awayTeam,
        homeTeamNormalized: normalizeTeamName(homeTeam),
        awayTeamNormalized: normalizeTeamName(awayTeam),
        rawOdds: parsedOdds
      });
    }

    // No validation here — server.js validates after section filtering
    const detailMarketsByMatch = {};
    for (const match of matches) {
      if (match.section === "super_sanca") {
        // Super sanca can contain many rows; keep extraction fast by using row-level fallback odds.
        detailMarketsByMatch[match.id] = [];
        continue;
      }
      const rowBtn = page
        .locator('[data-atid="bets-opponents"]')
        .filter({ hasText: match.homeTeam })
        .filter({ hasText: match.awayTeam })
        .first();
      try {
        if (await rowBtn.count()) {
          await rowBtn.click({ timeout: 3500 });
          await delay(1800);
          const detailMarkets = await page.evaluate(() => {
            const clean = (v) => (v || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
            const accordions = Array.from(document.querySelectorAll('[data-atid="market-accordion"]'));
            return accordions.map((acc) => {
              const marketName = clean(acc.textContent || "");
              const panel = acc.nextElementSibling;
              if (!panel) return { marketName, rows: [] };
              const groupRows = Array.from(panel.querySelectorAll('[data-atid="bet-group-view"]'));
              const rows = (groupRows.length ? groupRows : [panel]).map((row) => ({
                text: clean(row.textContent || ""),
                odds: Array.from(row.querySelectorAll('[data-atid="n1-bet-odd"]'))
                  .map((el) => clean(el.textContent || ""))
                  .filter(Boolean)
              }));
              return { marketName, rows };
            }).filter((m) => m.marketName);
          });
          detailMarketsByMatch[match.id] = detailMarkets;
        } else {
          detailMarketsByMatch[match.id] = [];
        }
      } catch {
        detailMarketsByMatch[match.id] = [];
      }
    }

    const fallbackMarkets = buildMarketsFromCardOdds(matches);
    const detailMarkets = matches.flatMap((m) => parseNikeDetailMarketsForMatch(m, detailMarketsByMatch[m.id] || []));
    // Detail markets first — dedupeMarkets keeps the first occurrence per logical key,
    // so detail-scraped odds have priority over fallback/card odds.
    const markets = dedupeMarkets([...detailMarkets, ...fallbackMarkets]);
    const debugInfo = {
      title: extracted.title,
      finalUrl: extracted.finalUrl,
      firstLines: extracted.firstLines,
      candidateCardsCount: extracted.candidateCards.length,
      candidateUniqueMatchCount: new Set(extracted.candidateCards.map((c) => `${normalizeTeamName(c.homeTeam || "")}__${normalizeTeamName(c.awayTeam || "")}`)).size,
      candidateUniqueMatches: [...new Set(extracted.candidateCards.map((c) => `${c.homeTeam || ""} vs ${c.awayTeam || ""}`))],
      sampleCards: extracted.candidateCards.slice(0, 12),
      parsedMatchesCount: matches.length,
      parsedMarketsCount: markets.length,
      detailMarketsByMatch
    };

    return { sourceUrl: extracted.finalUrl, sourceSiteMode: siteMode, matches, markets, debugInfo };
  } finally {
    await browser.close();
  }
}

export async function scrapeNikeSuperkurzy({ headless = true, timeoutMs = 45000, siteMode = NIKE_SITE_MODE } = {}) {
  const result = await scrapeNikeCore({ headless, timeoutMs, saveDebugArtifacts: false, siteMode });
  return { sourceUrl: result.sourceUrl, sourceSiteMode: result.sourceSiteMode, matches: result.matches, markets: result.markets };
}

export async function debugNikeSuperkurzy({ headless = true, timeoutMs = 45000, siteMode = NIKE_SITE_MODE } = {}) {
  return scrapeNikeCore({ headless, timeoutMs, saveDebugArtifacts: true, siteMode });
}
