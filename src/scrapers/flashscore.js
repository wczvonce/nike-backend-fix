import { chromium } from "playwright";
import { normalizeTeamName, parseOdd } from "../utils/normalize.js";
import { delay } from "../utils/delay.js";
import { getMarketHandler } from "../markets/handlers.js";

const FLASHSCORE_BASE = "https://www.flashscore.sk";
const DEFAULT_VIEWPORT = { width: 1280, height: 1800 };
const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const FLASHCORE_RESOURCE_BLOCKLIST = new Set(["image", "media", "font"]);

const MARKET_ODDS_ROUTE_SLUGS = {
  double_chance: "dvojita-sanca",
  match_winner_2way: "home-away",
  over_under_2way: "over-under",
  asian_handicap_2way: "azijsky-handicap",
  both_teams_to_score: "obaja-daju-gol",
  draw_no_bet_2way: "stavka-bez-remizy",
  european_handicap_2way: "europsky-handicap",
  team_to_score_yes_no: "tim-da-gol"
};

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

function periodToFlashscoreSlug(period = "full_time") {
  const p = String(period || "full_time").toLowerCase();
  if (p === "first_set") return "1-set";
  if (p === "second_set") return "2-set";
  return "zakladny-cas";
}

function toDirectOddsUrls(matchUrl = "", marketType = "", period = "full_time") {
  const normalized = normalizeMatchUrl(matchUrl);
  const noQuery = normalized.split("?")[0].replace(/\/+$/, "");
  const marketSlug = MARKET_ODDS_ROUTE_SLUGS[marketType] || "";
  const periodSlug = periodToFlashscoreSlug(period);
  const urls = new Set();
  if (marketSlug) {
    urls.add(`${noQuery}/${marketSlug}/${periodSlug}/`);
    if (period === "full_time") {
      urls.add(`${noQuery}/${marketSlug}/`);
    }
  }
  urls.add(`${noQuery}/`);
  return [...urls];
}

function normalizeToken(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function periodMatchesScope(period = "full_time", scope = "") {
  const s = normalizeToken(scope);
  if (period === "first_set") return /first_set|set_1|1_set/.test(s);
  if (period === "second_set") return /second_set|set_2|2_set/.test(s);
  if (period === "first_half") return /first_half|1st_half/.test(s);
  if (period === "second_half") return /second_half|2nd_half/.test(s);
  return /full_time|regular_time|match|normal_time|default/.test(s) || s === "";
}

function marketTypeMatchesBettingType(marketType = "", bettingType = "") {
  const t = normalizeToken(bettingType);
  if (marketType === "double_chance") return /double_chance/.test(t);
  if (marketType === "match_winner_2way") return /home_away|winner/.test(t);
  if (marketType === "over_under_2way") return /over_under|totals/.test(t);
  if (marketType === "asian_handicap_2way") return /asian_handicap/.test(t);
  if (marketType === "both_teams_to_score") return /both_teams_to_score|btts/.test(t);
  if (marketType === "draw_no_bet_2way") return /draw_no_bet/.test(t);
  if (marketType === "european_handicap_2way") return /european_handicap/.test(t);
  if (marketType === "team_to_score_yes_no") return /team_to_score/.test(t);
  return false;
}

function parseNetworkSelectionKey(item = {}, index = 0, marketType = "") {
  const selection = normalizeToken(item.selection || item.winner || item.position || "");
  if (marketType === "double_chance") {
    const direct = selection.replace(/_/g, "");
    if (["1x", "12", "x2"].includes(direct)) return direct;
    return null;
  }
  if (marketType === "over_under_2way") {
    if (/over/.test(selection)) return "over";
    if (/under/.test(selection)) return "under";
    return index % 2 === 0 ? "over" : "under";
  }
  if (marketType === "asian_handicap_2way" || marketType === "match_winner_2way" || marketType === "draw_no_bet_2way") {
    return index % 2 === 0 ? "home" : "away";
  }
  if (marketType === "both_teams_to_score" || marketType === "team_to_score_yes_no") {
    if (typeof item.bothTeamsToScore === "boolean") return item.bothTeamsToScore ? "yes" : "no";
    if (/yes|ano|true/.test(selection)) return "yes";
    if (/no|nie|false/.test(selection)) return "no";
    return index % 2 === 0 ? "yes" : "no";
  }
  return null;
}

function toLineValue(value) {
  if (value == null || value === "") return null;
  const num = Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? Number(num.toFixed(2)) : null;
}

export function parseGraphqlOddsToSnapshot(payload, { marketType, period, marketName }) {
  const root = payload?.data?.findOddsByEventId || {};
  const byBookmakerId = new Map(
    (root?.settings?.bookmakers || []).map((x) => [String(x?.bookmaker?.id || ""), x?.bookmaker?.name || ""])
  );
  const oddsEntries = Array.isArray(root?.odds) ? root.odds : [];
  const filtered = oddsEntries.filter((entry) => (
    marketTypeMatchesBettingType(marketType, entry?.bettingType) &&
    periodMatchesScope(period, entry?.bettingScope || "")
  ));
  const labels = (() => {
    if (marketType === "double_chance") return ["1X", "12", "X2"];
    if (marketType === "match_winner_2way") return ["1", "2"];
    if (marketType === "over_under_2way") return ["Celkom", "Over", "Under"];
    if (marketType === "asian_handicap_2way") return ["Handicap", "1", "2"];
    if (marketType === "both_teams_to_score") return ["Yes", "No"];
    if (marketType === "draw_no_bet_2way") return ["1", "2"];
    if (marketType === "team_to_score_yes_no") return ["Yes", "No"];
    return [];
  })();

  const rows = [];
  for (const entry of filtered) {
    const bookmaker = byBookmakerId.get(String(entry?.bookmakerId || "")) || `Bookmaker ${entry?.bookmakerId || ""}`;
    const items = Array.isArray(entry?.odds) ? entry.odds.filter((x) => x?.active !== false && x?.value != null) : [];
    if (!items.length) continue;
    const lineGroups = new Map();
    for (const [idx, item] of items.entries()) {
      const line = toLineValue(item?.handicap);
      const key = line == null ? "null" : String(line);
      if (!lineGroups.has(key)) lineGroups.set(key, { line, entries: [] });
      lineGroups.get(key).entries.push({ item, idx });
    }
    for (const group of lineGroups.values()) {
      const selectionOdds = {};
      for (const [localIdx, wrapped] of group.entries.entries()) {
        const key = parseNetworkSelectionKey(wrapped.item, localIdx, marketType);
        const odd = parseOdd(String(wrapped.item?.value ?? ""), { rejectDateLike: false, rejectTimeLike: false });
        if (!key || odd == null) continue;
        selectionOdds[key] = odd;
      }
      const oddOrder = (() => {
        if (marketType === "double_chance") return ["1x", "12", "x2"];
        if (marketType === "over_under_2way") return ["over", "under"];
        if (marketType === "both_teams_to_score" || marketType === "team_to_score_yes_no") return ["yes", "no"];
        return ["home", "away"];
      })();
      const oddTexts = oddOrder.map((k) => selectionOdds[k]).filter((v) => v != null).map((v) => String(v));
      rows.push({
        bookmaker,
        bookmakerId: String(entry?.bookmakerId || ""),
        oddTexts,
        lineText: group.line == null ? "" : String(group.line),
        rawRowText: `${marketName || marketType} ${bookmaker} ${JSON.stringify(selectionOdds)}`,
        _selectionOddsFromNetwork: selectionOdds
      });
    }
  }
  return {
    labels,
    activeHints: filtered.map((e) => `${e?.bettingType || ""}:${e?.bettingScope || ""}`),
    rows
  };
}

async function getGraphqlPayloadForEvent(session, matchUrl, timeoutMs) {
  const key = normalizeMatchUrl(matchUrl);
  if (!session.eventCache) session.eventCache = new Map();
  if (session.eventCache.has(key)) return session.eventCache.get(key);

  await session.page.goto(key, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await session.page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 10000) }).catch(() => {});
  const graphqlReq = [...session.networkLog]
    .reverse()
    .find((x) => /global\.ds\.lsapp\.eu\/odds\/pq_graphql/i.test(x?.url || ""));
  if (!graphqlReq?.url) {
    session.eventCache.set(key, null);
    return null;
  }
  let payload = null;
  try {
    const direct = await fetch(graphqlReq.url, {
      headers: {
        "User-Agent": DEFAULT_UA,
        "Accept": "application/json,text/plain,*/*"
      }
    });
    if (direct.ok) {
      payload = await direct.json().catch(() => null);
    }
  } catch {
    // ignore and fallback to context request below
  }
  if (!payload) {
    const response = await session.request.get(graphqlReq.url, { timeout: timeoutMs });
    if (response.ok()) {
      payload = await response.json().catch(() => null);
    }
  }
  if (!payload?.data?.findOddsByEventId) {
    session.eventCache.set(key, null);
    return null;
  }
  const data = { graphqlUrl: graphqlReq.url, payload };
  session.eventCache.set(key, data);
  return data;
}

function normalizeHeaderToken(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function periodConfigFromKey(period = "full_time") {
  const p = String(period || "full_time").toLowerCase();
  if (p === "first_set") {
    return {
      period: "first_set",
      periodName: "1. set",
      clickRegex: /1\.\s*SET|1ST SET/i
    };
  }
  if (p === "second_set") {
    return {
      period: "second_set",
      periodName: "2. set",
      clickRegex: /2\.\s*SET|2ND SET/i
    };
  }
  return {
    period: "full_time",
    periodName: "Základný čas",
    clickRegex: /Z[ÁA]KLADN[ÝY]\s*[ČC]AS|FULL TIME/i
  };
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
  if (oddsSuffix && normalizedRaw.endsWith(oddsSuffix) && normalizedRaw.length >= oddsSuffix.length) {
    candidate = normalizedRaw.slice(0, -oddsSuffix.length);
  }
  const matches = candidate.match(/[-+]?\d+(?:[.,]\d+)?/g);
  if (!matches || !matches.length) return null;
  // In merged-line formats (-2,-2.5), keep the last captured line token.
  return parseLineValue(matches[matches.length - 1]);
}

async function extractOddsTableFromPage(page) {
  return page.evaluate(() => {
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
}

export async function createFlashscoreSession({ headless = true, timeoutMs = 45000 } = {}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT, userAgent: DEFAULT_UA });
  await context.route("**/*", (route) => {
    const req = route.request();
    const resourceType = req.resourceType();
    const url = req.url();
    if (FLASHCORE_RESOURCE_BLOCKLIST.has(resourceType)) return route.abort();
    if (/googlesyndication|doubleclick|adservice|google-analytics/i.test(url)) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  const parserPage = await context.newPage();
  const networkLog = [];
  const responseListener = async (res) => {
    try {
      const req = res.request();
      const method = req.method();
      const type = req.resourceType();
      const url = res.url();
      if (!["xhr", "fetch", "document"].includes(type)) return;
      if (!/flashscore|odds|kurzy|bookmaker|event|prematch|feed|api/i.test(url)) return;
      networkLog.push({
        url,
        method,
        status: res.status(),
        contentType: res.headers()["content-type"] || "",
        ts: Date.now()
      });
      if (networkLog.length > 80) networkLog.shift();
    } catch {
      // ignore logging failures
    }
  };
  page.on("response", responseListener);
  const metrics = {
    browserLaunches: 1,
    startedAtMs: Date.now(),
    networkFirstHits: 0,
    domFallbackHits: 0
  };
  return {
    browser,
    context,
    page,
    parserPage,
    networkLog,
    eventCache: new Map(),
    metrics,
    timeoutMs,
    request: context.request,
    async close() {
      page.off("response", responseListener);
      await context.close();
      await browser.close();
    }
  };
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
  period = "full_time",
  session = null,
  headless = true,
  timeoutMs = 45000
}) {
  const url = normalizeMatchUrl(matchUrl);
  const periodConfig = periodConfigFromKey(period);
  const ownSession = session || await createFlashscoreSession({ headless, timeoutMs });
  try {
    // NETWORK-FIRST primary path: get event odds payload from Flashscore internal graphql endpoint.
    const graphqlData = await getGraphqlPayloadForEvent(ownSession, url, timeoutMs).catch(() => null);
    if (graphqlData?.payload) {
      const snapshot = parseGraphqlOddsToSnapshot(graphqlData.payload, { marketType, period: periodConfig.period, marketName });
      const normalizedFromGraphql = normalizeFlashscoreMarketSnapshot(
        {
          labels: snapshot.labels,
          rows: snapshot.rows,
          activeHints: snapshot.activeHints
        },
        {
          marketType,
          marketName,
          expectedLabels,
          labelAliases,
          requireExactLabelSet,
          expectedOddCount,
          requireLine,
          period: periodConfig.period,
          periodName: periodConfig.periodName
        },
        graphqlData.graphqlUrl
      );
      if ((normalizedFromGraphql.bookmakerRows || []).length > 0) {
        ownSession.metrics.networkFirstHits += 1;
        return {
          ...normalizedFromGraphql,
          sourceType: "network_graphql",
          directOddsUrl: graphqlData.graphqlUrl,
          networkRequests: ownSession.networkLog.slice(-20),
          runtimeMs: Date.now() - ownSession.metrics.startedAtMs
        };
      }
    }

    // NETWORK-FIRST: fetch direct odds page HTML with browser session cookies/request context.
    const directCandidates = toDirectOddsUrls(url, marketType, periodConfig.period);
    for (const directUrl of directCandidates) {
      try {
        const resp = await ownSession.request.get(directUrl, { timeout: timeoutMs });
        if (!resp.ok()) continue;
        const html = await resp.text();
        if (!html || html.length < 500) continue;
        await ownSession.parserPage.setContent(html, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        const directTable = await extractOddsTableFromPage(ownSession.parserPage);
        const normalizedDirect = normalizeFlashscoreMarketSnapshot(
          {
            labels: directTable.labels,
            rows: directTable.rows,
            activeHints: directTable.activeHints
          },
          {
            marketType,
            marketName,
            expectedLabels,
            labelAliases,
            requireExactLabelSet,
            expectedOddCount,
            requireLine,
            period: periodConfig.period,
            periodName: periodConfig.periodName
          },
          directUrl
        );
        if ((normalizedDirect.bookmakerRows || []).length > 0) {
          ownSession.metrics.networkFirstHits += 1;
          return {
            ...normalizedDirect,
            sourceType: "network_direct_html",
            directOddsUrl: directUrl,
            networkRequests: ownSession.networkLog.slice(-20),
            runtimeMs: Date.now() - ownSession.metrics.startedAtMs
          };
        }
      } catch {
        // Try next direct URL candidate.
      }
    }

    // DOM fallback on a real page (still same browser/context/session).
    const page = ownSession.page;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 10000) }).catch(() => {});
    await page.getByText(tabRegex).first().click({ timeout: 4500 }).catch(() => {});
    await page.getByText(periodConfig.clickRegex).first().click({ timeout: 2200 }).catch(() => {});
    await page.waitForSelector(".ui-table__row", { timeout: 5000 }).catch(() => {});
    const table = await extractOddsTableFromPage(page);

    const normalizedFallback = normalizeFlashscoreMarketSnapshot(
      {
        labels: table.labels,
        rows: table.rows,
        activeHints: table.activeHints
      },
      {
        marketType,
        marketName,
        expectedLabels,
        labelAliases,
        requireExactLabelSet,
        expectedOddCount,
        requireLine,
        period: periodConfig.period,
        periodName: periodConfig.periodName
      },
      url
    );
    ownSession.metrics.domFallbackHits += 1;
    return {
      ...normalizedFallback,
      sourceType: "dom_fallback",
      directOddsUrl: null,
      networkRequests: ownSession.networkLog.slice(-20),
      runtimeMs: Date.now() - ownSession.metrics.startedAtMs
    };
  } finally {
    if (!session) {
      await ownSession.close();
    }
  }
}

export function normalizeFlashscoreMarketSnapshot(snapshot, config, matchUrl = "") {
  const {
    marketType,
    marketName,
    expectedLabels = [],
    labelAliases = {},
    requireExactLabelSet = false,
    expectedOddCount,
    requireLine = false,
    period = "full_time",
    periodName = "Základný čas"
  } = config || {};
  const safeSnapshot = snapshot || { labels: [], rows: [], activeHints: [] };
  const canonicalLabels = [...new Set(
    (safeSnapshot.labels || [])
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
        period,
        periodName,
        matchUrl,
        columnLabels: canonicalLabels,
        activeHints: safeSnapshot.activeHints || [],
        bookmakerRows: []
      };
    }
    if (requireExactLabelSet && (canonicalLabels.length !== expected.length || !canonicalLabels.every((x, idx) => x === expected[idx]))) {
      return {
        marketType,
        marketName,
        period,
        periodName,
        matchUrl,
        columnLabels: canonicalLabels,
        activeHints: safeSnapshot.activeHints || [],
        bookmakerRows: []
      };
    }
  }

  const parsedRows = (safeSnapshot.rows || []).map((row) => {
    const oddTexts = Array.isArray(row.oddTexts) ? row.oddTexts : [];
    const parsedOdds = oddTexts
      .map((v) => parseOdd(v, { rejectDateLike: false, rejectTimeLike: false }))
      .filter((x) => x !== null);
    const lineValue = requireLine ? (parseLineValue(row.lineText) ?? parseLineFromRow(row.rawRowText, oddTexts)) : null;
    return {
      bookmaker: row.bookmaker || "",
      bookmakerId: row.bookmakerId || null,
      line: lineValue,
      lineRaw: row.lineText || "",
      extractedOddsArray: parsedOdds,
      rawRowText: row.rawRowText || "",
      selectionOdds: row._selectionOddsFromNetwork || null
    };
  }).filter((row) => {
    if (!row.bookmaker) return false;
    if (expectedOddCount != null && row.extractedOddsArray.length !== expectedOddCount) return false;
    if (requireLine && row.line == null) return false;
    return true;
  });

  return {
    marketType,
    marketName,
    period,
    periodName,
    matchUrl,
    columnLabels: canonicalLabels,
    activeHints: safeSnapshot.activeHints || [],
    bookmakerRows: parsedRows
  };
}

function mapDcRows(rows = []) {
  const dcRange = (o) => o != null && o >= 1.05 && o <= 4.5;
  return rows
    .map((row) => ({
      ...row,
      selectionOdds: row.selectionOdds || {
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
      selectionOdds: row.selectionOdds || {
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

function keepDistinctRowsByKey(rows = [], keyBuilder) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const key = keyBuilder(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function toScrapeConfigFromHandler(handler, override = {}) {
  return {
    tabRegex: override.tabRegex || handler?.tabRegex,
    marketType: handler?.marketType,
    marketName: override.marketName || handler?.displayName || "Unknown market",
    expectedLabels: handler?.expectedLabels || [],
    labelAliases: handler?.labelAliases || {},
    requireExactLabelSet: handler?.requireExactLabelSet || false,
    expectedOddCount: handler?.expectedOddCount,
    requireLine: handler?.requireLine || false
  };
}

export async function scrapeFlashscoreDoubleChance({ matchUrl, period = "full_time", session = null, headless = true, timeoutMs = 45000 }) {
  const handler = getMarketHandler("double_chance");
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    ...toScrapeConfigFromHandler(handler),
    period,
    session,
    headless,
    timeoutMs
  });
  return {
    ...base,
    columnLabels: base.columnLabels.map((x) => x.toUpperCase()),
    bookmakerRows: keepFirstPerBookmaker(mapDcRows(base.bookmakerRows))
  };
}

export async function scrapeFlashscoreTipsportWinner2Way({ matchUrl, period = "full_time", session = null, headless = true, timeoutMs = 45000 }) {
  const handler = getMarketHandler("match_winner_2way");
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    ...toScrapeConfigFromHandler(handler),
    period,
    session,
    headless,
    timeoutMs
  });
  return {
    ...base,
    bookmakerRows: keepFirstPerBookmaker(mapTwoWayRows(base.bookmakerRows, "home", "away", 1.01, 20))
  };
}

export async function scrapeFlashscoreOverUnder2Way({ matchUrl, period = "full_time", session = null, headless = true, timeoutMs = 45000 }) {
  const handler = getMarketHandler("over_under_2way");
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    ...toScrapeConfigFromHandler(handler),
    period,
    session,
    headless,
    timeoutMs
  });
  return {
    ...base,
    bookmakerRows: keepDistinctRowsByKey(
      mapTwoWayRows(base.bookmakerRows, "over", "under", 1.01, 20),
      (row) => `${normalizeHeaderToken(row.bookmaker)}|${row.line ?? "null"}`
    )
  };
}

export async function scrapeFlashscoreAsianHandicap2Way({ matchUrl, period = "full_time", session = null, headless = true, timeoutMs = 45000 }) {
  const handler = getMarketHandler("asian_handicap_2way");
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    ...toScrapeConfigFromHandler(handler),
    period,
    session,
    headless,
    timeoutMs
  });
  return {
    ...base,
    bookmakerRows: keepDistinctRowsByKey(
      mapTwoWayRows(base.bookmakerRows, "home", "away", 1.01, 20),
      (row) => `${normalizeHeaderToken(row.bookmaker)}|${row.line ?? "null"}`
    )
  };
}

export async function scrapeFlashscoreBttsYesNo({ matchUrl, period = "full_time", session = null, headless = true, timeoutMs = 45000 }) {
  const handler = getMarketHandler("both_teams_to_score");
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    ...toScrapeConfigFromHandler(handler),
    period,
    session,
    headless,
    timeoutMs
  });
  return {
    ...base,
    bookmakerRows: keepFirstPerBookmaker(mapTwoWayRows(base.bookmakerRows, "yes", "no", 1.01, 20))
  };
}

export async function scrapeFlashscoreDrawNoBet2Way({ matchUrl, period = "full_time", session = null, headless = true, timeoutMs = 45000 }) {
  const handler = getMarketHandler("draw_no_bet_2way");
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    ...toScrapeConfigFromHandler(handler),
    period,
    session,
    headless,
    timeoutMs
  });
  return {
    ...base,
    bookmakerRows: keepFirstPerBookmaker(mapTwoWayRows(base.bookmakerRows, "home", "away", 1.01, 20))
  };
}

export async function scrapeFlashscoreEuropeanHandicap2Way({ matchUrl, period = "full_time", session = null, headless = true, timeoutMs = 45000 }) {
  const handler = getMarketHandler("european_handicap_2way");
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    ...toScrapeConfigFromHandler(handler),
    period,
    session,
    headless,
    timeoutMs
  });
  return {
    ...base,
    bookmakerRows: keepFirstPerBookmaker(mapTwoWayRows(base.bookmakerRows, "home", "away", 1.01, 20))
  };
}

export async function scrapeFlashscoreGenericYesNo({ matchUrl, tabRegex, marketName = "Yes/No", period = "full_time", session = null, headless = true, timeoutMs = 45000 }) {
  const handler = getMarketHandler("generic_yes_no");
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    ...toScrapeConfigFromHandler(handler, { tabRegex, marketName }),
    period,
    session,
    headless,
    timeoutMs
  });
  return {
    ...base,
    bookmakerRows: keepFirstPerBookmaker(mapTwoWayRows(base.bookmakerRows, "yes", "no", 1.01, 20))
  };
}

export async function scrapeFlashscoreTeamToScoreYesNo({ matchUrl, period = "full_time", session = null, headless = true, timeoutMs = 45000 }) {
  const handler = getMarketHandler("team_to_score_yes_no");
  const base = await scrapeFlashscoreMarketTable({
    matchUrl,
    ...toScrapeConfigFromHandler(handler),
    period,
    session,
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
export async function scrapeFlashscoreMarketByType({ matchUrl, marketType, period = "full_time", session = null, headless = true, timeoutMs = 45000 }) {
  switch (marketType) {
    case "double_chance":
      return scrapeFlashscoreDoubleChance({ matchUrl, period, session, headless, timeoutMs });
    case "match_winner_2way":
      return scrapeFlashscoreTipsportWinner2Way({ matchUrl, period, session, headless, timeoutMs });
    case "over_under_2way":
      return scrapeFlashscoreOverUnder2Way({ matchUrl, period, session, headless, timeoutMs });
    case "asian_handicap_2way":
      return scrapeFlashscoreAsianHandicap2Way({ matchUrl, period, session, headless, timeoutMs });
    case "both_teams_to_score":
      return scrapeFlashscoreBttsYesNo({ matchUrl, period, session, headless, timeoutMs });
    case "draw_no_bet_2way":
      return scrapeFlashscoreDrawNoBet2Way({ matchUrl, period, session, headless, timeoutMs });
    case "european_handicap_2way":
      return scrapeFlashscoreEuropeanHandicap2Way({ matchUrl, period, session, headless, timeoutMs });
    case "team_to_score_yes_no":
      return scrapeFlashscoreTeamToScoreYesNo({ matchUrl, period, session, headless, timeoutMs });
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
