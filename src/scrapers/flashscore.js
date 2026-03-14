import { chromium } from "playwright";
import { normalizeTeamName, parseOdd } from "../utils/normalize.js";
import { delay } from "../utils/delay.js";

const FLASHSCORE_BASE = "https://www.flashscore.sk";

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

export async function scrapeFlashscoreDoubleChance({ matchUrl, headless = true, timeoutMs = 45000 }) {
  const normalizedUrl = (matchUrl || "").trim();
  if (!normalizedUrl) throw new Error("matchUrl is required");
  let url = normalizedUrl;
  if (!/^https?:\/\//i.test(url)) {
    const base = "https://www.flashscore.sk";
    url = url.startsWith("/") ? base + url : base + "/" + url;
  }
  if (!/\/kurzy\b/.test(url)) url = url.replace(/\/$/, "") + "/kurzy";
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1800 }, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36" });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await delay(2500);
    await page.getByText(/DVOJITÁ ŠANCA|DOUBLE CHANCE/i).first().click({ timeout: 4000 }).catch(() => {});
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
        return {
          bookmaker,
          bookmakerId,
          oddTexts,
          rawRowText: clean(row.textContent)
        };
      }).filter((r) => r.bookmaker && r.oddTexts.length >= 2);

      return { labels, activeHints, rows };
    });

    const dcRange = (o) => o != null && o >= 1.05 && o <= 4.5;
    const canonicalLabels = [...new Set(
      table.labels
        .map((x) => x.toUpperCase())
        .filter((x) => ["1X", "12", "X2"].includes(x))
    )];
    const hasExactDcLabels =
      canonicalLabels.length === 3 &&
      canonicalLabels[0] === "1X" &&
      canonicalLabels[1] === "12" &&
      canonicalLabels[2] === "X2";
    if (!hasExactDcLabels) {
      return {
        marketType: "double_chance",
        marketName: "Dvojitá šanca",
        period: "full_time",
        periodName: "Základný čas",
        matchUrl: url,
        columnLabels: canonicalLabels,
        activeHints: table.activeHints,
        bookmakerRows: []
      };
    }
    const toOdd = (v) => parseOdd(v, { rejectDateLike: false });
    const normalizedRows = table.rows.map((r) => {
      const odds = r.oddTexts.map(toOdd).filter((x) => x !== null);
      const picked = odds.length === 3 ? odds : [null, null, null];
      const selectionOdds = { "1x": picked[0] ?? null, "12": picked[1] ?? null, "x2": picked[2] ?? null };
      return {
        bookmaker: r.bookmaker,
        bookmakerId: r.bookmakerId || null,
        selectionOdds,
        rawRowText: r.rawRowText,
        extractedOddsArray: picked[0] != null ? picked : []
      };
    }).filter((r) => r.selectionOdds["1x"] != null && r.selectionOdds["12"] != null && r.selectionOdds["x2"] != null);

    const result = [];
    const byBookmaker = new Set();
    for (const row of normalizedRows) {
      if (byBookmaker.has(row.bookmaker.toLowerCase())) continue;
      byBookmaker.add(row.bookmaker.toLowerCase());
      if (dcRange(row.selectionOdds["1x"]) && dcRange(row.selectionOdds["12"]) && dcRange(row.selectionOdds["x2"])) {
        result.push(row);
      }
    }

    return {
      marketType: "double_chance",
      marketName: "Dvojitá šanca",
      period: "full_time",
      periodName: "Základný čas",
      matchUrl: url,
      columnLabels: canonicalLabels,
      activeHints: table.activeHints,
      bookmakerRows: result
    };
  } finally {
    await browser.close();
  }
}

export async function scrapeFlashscoreTipsportWinner2Way({ matchUrl, headless = true, timeoutMs = 45000 }) {
  const normalizedUrl = (matchUrl || "").trim();
  if (!normalizedUrl) throw new Error("matchUrl is required");
  let url = normalizedUrl;
  if (!/^https?:\/\//i.test(url)) {
    url = url.startsWith("/") ? `${FLASHSCORE_BASE}${url}` : `${FLASHSCORE_BASE}/${url}`;
  }
  if (!/\/kurzy\b/.test(url)) url = url.replace(/\/$/, "") + "/kurzy";

  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await delay(2500);
    await page.getByText(/1X2|VÍŤAZ ZÁPASU|MATCH WINNER/i).first().click({ timeout: 3000 }).catch(() => {});
    await delay(1200);
    await page.getByText(/ZÁKLADNÝ ČAS|FULL TIME/i).first().click({ timeout: 2000 }).catch(() => {});
    await delay(1000);

    const table = await page.evaluate(() => {
      const clean = (v) => (v || "").replace(/\s+/g, " ").trim();
      const labels = [...new Set(
        Array.from(document.querySelectorAll("*"))
          .map((el) => clean(el.textContent))
          .filter((t) => ["1", "2", "HOME", "AWAY"].includes(t.toUpperCase()))
      )];
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
        return {
          bookmaker,
          bookmakerId,
          oddTexts,
          rawRowText: clean(row.textContent)
        };
      }).filter((r) => r.bookmaker && r.oddTexts.length >= 2);
      return { labels, activeHints, rows };
    });

    const tipsportRow = table.rows.find((r) => /tipsport/i.test(r.bookmaker)) || null;
    const odds = (tipsportRow?.oddTexts || [])
      .map((t) => parseOdd(t, { rejectDateLike: false }))
      .filter((x) => x !== null && x >= 1.01 && x <= 20);
    const bestPair = odds.length >= 2 ? [odds[0], odds[1]] : [null, null];

    return {
      marketType: "match_winner_2way",
      marketName: "Víťaz zápasu / 1X2",
      period: "full_time",
      periodName: "Základný čas",
      matchUrl: url,
      columnLabels: table.labels,
      activeHints: table.activeHints,
      bookmakerRows: [{
        bookmaker: tipsportRow?.bookmaker || "Tipsport",
        bookmakerId: tipsportRow?.bookmakerId || null,
        selectionOdds: { home: bestPair[0], away: bestPair[1] },
        extractedOddsArray: odds.slice(0, 6),
        rawRowText: tipsportRow?.rawRowText || ""
      }]
    };
  } finally {
    await browser.close();
  }
}
