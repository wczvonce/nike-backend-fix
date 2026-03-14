import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeTeamName, parseOdd } from "../utils/normalize.js";
import { delay } from "../utils/delay.js";

const NIKE_URLS = ["https://m.nike.sk/tipovanie", "https://www.nike.sk/tipovanie"];
const DC_SELECTIONS = ["1x", "12", "x2"];
const EXPECTED_SUPERPONUKA = [
  "Chelsea vs Newcastle Utd.",
  "Como vs AS Roma",
  "Michalovce vs Spišská N. Ves",
  "Sabalenka A. vs Rybakina E."
];
const EXPECTED_SPORT_BY_MATCH = {
  "Chelsea vs Newcastle Utd.": "football",
  "Como vs AS Roma": "football",
  "Michalovce vs Spišská N. Ves": "hockey",
  "Sabalenka A. vs Rybakina E.": "tennis"
};

function detectSportFromText(value = "") {
  const t = String(value || "").toLowerCase();
  if (t.includes("futbal") || t.includes("football")) return "football";
  if (t.includes("hokej") || t.includes("hockey")) return "hockey";
  if (t.includes("tenis") || t.includes("tennis")) return "tennis";
  return "unknown";
}

function splitParticipants(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return { homeTeam: "", awayTeam: "" };
  const parts = raw.split(/\s+(?:vs|v\.?)\s+|-/i).map((p) => p.trim()).filter(Boolean);
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

function validateSuperponukaMatches(matches) {
  if (!Array.isArray(matches) || matches.length !== 4) {
    throw new Error(`Nike Superponuka validation failed: expected 4 matches, got ${matches?.length ?? 0}`);
  }
  const expected = EXPECTED_SUPERPONUKA.map((m) => normalizeMatchLabel(m));
  const got = matches.map((m) => normalizeMatchLabel(m.rawTitle));
  if (new Set(got).size !== got.length) {
    throw new Error("Nike Superponuka validation failed: duplicates found");
  }
  for (const label of expected) {
    if (!got.includes(label)) {
      throw new Error(`Nike Superponuka validation failed: missing expected match "${label}"`);
    }
  }
  for (const label of got) {
    if (!expected.includes(label)) {
      throw new Error(`Nike Superponuka validation failed: unexpected extra match "${label}"`);
    }
  }
  for (const match of matches) {
    const expectedSport = EXPECTED_SPORT_BY_MATCH[match.rawTitle];
    if (!expectedSport) throw new Error(`Nike Superponuka validation failed: unknown match "${match.rawTitle}"`);
    if (match.sport !== expectedSport) {
      throw new Error(`Nike Superponuka validation failed: wrong sport for "${match.rawTitle}" (expected ${expectedSport}, got ${match.sport})`);
    }
  }
}

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

async function openNikePage(page, timeoutMs) {
  let lastError = null;
  for (const url of NIKE_URLS) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      return page.url();
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Nike page failed to load: ${lastError?.message || "unknown error"}`);
}

function buildMarkets(matches) {
  const markets = [];
  const dcRange = (o) => o >= 1.05 && o <= 4.5;
  for (const match of matches) {
    const odds = match.rawOdds;
    if (match.sport === "tennis") {
      if (odds.length >= 2) {
        markets.push({ id: `${match.id}-winner-home`, matchId: match.id, marketType: "match_winner_2way", period: "full_time", selection: "home", nikeOdd: odds[0] });
        markets.push({ id: `${match.id}-winner-away`, matchId: match.id, marketType: "match_winner_2way", period: "full_time", selection: "away", nikeOdd: odds[1] });
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
      markets.push({ id: `${match.id}-dc-1x`, matchId: match.id, marketType: "double_chance", period: "full_time", selection: DC_SELECTIONS[0], nikeOdd: dc1x });
      markets.push({ id: `${match.id}-dc-12`, matchId: match.id, marketType: "double_chance", period: "full_time", selection: DC_SELECTIONS[1], nikeOdd: dc12 });
      markets.push({ id: `${match.id}-dc-x2`, matchId: match.id, marketType: "double_chance", period: "full_time", selection: DC_SELECTIONS[2], nikeOdd: dcx2 });
    }
  }
  return markets;
}

async function scrapeNikeCore({ headless = true, timeoutMs = 45000, saveDebugArtifacts = false } = {}) {
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 2200 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();
    await openNikePage(page, timeoutMs);
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
      const candidateCards = [];
      for (const row of rows) {
        const rowText = clean(row.textContent || "").toLowerCase();
        const rowTitle = clean(row.querySelector("[title]")?.getAttribute("title") || "").toLowerCase();
        const boundaryParticipants = clean(row.querySelector('[data-atid="bets-opponents"]')?.getAttribute("data-participants") || "").toLowerCase();
        const boundaryBlob = `${rowText} ${rowTitle} ${boundaryParticipants}`;
        if (/super\s*š?anca/i.test(boundaryBlob)) break;
        const btn = row.querySelector('[data-atid="bets-opponents"]');
        if (!btn) continue;
        const rowEl = btn.closest("[data-game-state]") || btn.closest("li") || btn.parentElement?.parentElement || btn.parentElement;
        const oddEls = rowEl ? Array.from(rowEl.querySelectorAll('[data-atid$="bet-odd"], [data-atid*="bet-odd"]')) : [];
        const odds = oddEls.map((el) => clean(el.textContent)).filter(Boolean);

        const divParts = Array.from(btn.querySelectorAll("div")).map((d) => clean(d.textContent)).filter((x) => x && !/^vs$/i.test(x));
        const participantsAttr = clean(btn.getAttribute("data-participants") || btn.getAttribute("title") || "");
        const participants = participantsAttr || clean(btn.textContent || "");
        const homeTeam = divParts[0] || "";
        const awayTeam = divParts[1] || "";
        const metaTitle = clean(btn.getAttribute("title") || rowEl?.querySelector("[title]")?.getAttribute("title") || "");
        const dateMatch = metaTitle.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
        const kickoffAt = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}T${dateMatch[4]}:${dateMatch[5]}:00` : null;

        candidateCards.push({
          sport: clean(btn.getAttribute("data-sport") || rowEl?.querySelector("[data-sport]")?.getAttribute("data-sport") || ""),
          tournament: clean(btn.getAttribute("data-tournament") || ""),
          participants,
          homeTeam,
          awayTeam,
          kickoffAt,
          metaTitle,
          odds,
          rowSnippet: clean(rowEl?.textContent || "").slice(0, 500)
        });
        if (candidateCards.length > 20) break; // hard stop; Superponuka has only a few top rows
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
      const parsedOdds = card.odds.map((v) => parseOdd(v, { rejectDateLike: false })).filter((v) => v !== null);
      if (!homeTeam || !awayTeam || parsedOdds.length < 2) continue;
      const uniqueOdds = [...new Set(parsedOdds)];
      const dedupKey = `${normalizeTeamName(homeTeam)}__${normalizeTeamName(awayTeam)}__${card.tournament || ""}`;
      if (seenMatches.has(dedupKey)) continue;
      seenMatches.add(dedupKey);
      matches.push({
        id: `nike-${matchId++}`,
        source: "nike",
        sport: detectSportFromText(card.sport || card.tournament),
        tournament: card.tournament || null,
        kickoffAt: card.kickoffAt || null,
        rawTitle: `${homeTeam} vs ${awayTeam}`,
        homeTeam,
        awayTeam,
        homeTeamNormalized: normalizeTeamName(homeTeam),
        awayTeamNormalized: normalizeTeamName(awayTeam),
        rawOdds: uniqueOdds
      });
    }

    validateSuperponukaMatches(matches);
    const markets = buildMarkets(matches);
    const debugInfo = {
      title: extracted.title,
      finalUrl: extracted.finalUrl,
      firstLines: extracted.firstLines,
      candidateCardsCount: extracted.candidateCards.length,
      sampleCards: extracted.candidateCards.slice(0, 12),
      parsedMatchesCount: matches.length,
      parsedMarketsCount: markets.length
    };

    return { sourceUrl: extracted.finalUrl, matches, markets, debugInfo };
  } finally {
    await browser.close();
  }
}

export async function scrapeNikeSuperkurzy({ headless = true, timeoutMs = 45000 } = {}) {
  const result = await scrapeNikeCore({ headless, timeoutMs, saveDebugArtifacts: false });
  return { sourceUrl: result.sourceUrl, matches: result.matches, markets: result.markets };
}

export async function debugNikeSuperkurzy({ headless = true, timeoutMs = 45000 } = {}) {
  return scrapeNikeCore({ headless, timeoutMs, saveDebugArtifacts: true });
}
