import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const DEBUG_DIR = path.resolve("debug");
const OUT_HTML = path.join(DEBUG_DIR, "nike-page.html");
const OUT_TXT = path.join(DEBUG_DIR, "nike-page.txt");
const OUT_PNG = path.join(DEBUG_DIR, "nike-page.png");
const headless = String(process.env.HEADLESS || "false") !== "false";
const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 60000);
const urls = ["https://m.nike.sk/tipovanie", "https://www.nike.sk/tipovanie"];

function getInterestingLines(lines) {
  return lines.filter((line) => {
    if (!line) return false;
    if (/\b(vs|v\.)\b/i.test(line)) return true;
    if (/\d{1,2}[.,]\d{1,2}/.test(line)) return true;
    if (/futbal|hokej|tenis|superkurzy|zapas|zápas|kurz/i.test(line)) return true;
    return false;
  });
}

const browser = await chromium.launch({ headless });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 2200 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  let finalUrl = "";
  let loaded = false;
  let lastErr = "";
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      loaded = true;
      finalUrl = page.url();
      break;
    } catch (err) {
      lastErr = String(err?.message || err);
    }
  }
  if (!loaded) throw new Error(`Could not load Nike page: ${lastErr}`);

  for (const selector of ["button:has-text('Súhlasím')", "button:has-text('Prijať')", "button:has-text('Accept')", "#onetrust-accept-btn-handler"]) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.count()) {
        await locator.click({ timeout: 1000 });
        await page.waitForTimeout(500);
      }
    } catch {
      // ignore
    }
  }

  await page.waitForTimeout(5000);
  await page.screenshot({ path: OUT_PNG, fullPage: true });
  const html = await page.content();
  await fs.writeFile(OUT_HTML, html, "utf8");

  const debug = await page.evaluate(() => {
    const bodyText = (document.body?.innerText || "").replace(/\u00a0/g, " ");
    const lines = bodyText.split("\n").map((x) => x.trim()).filter(Boolean);

    const selectors = [
      "[class*='event']",
      "[class*='match']",
      "[class*='coupon']",
      "[class*='card']",
      "[class*='row']",
      "article",
      "li",
      "tr",
      "div"
    ];

    const cards = [];
    const seen = new Set();
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        const txt = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (!txt || txt.length < 10 || txt.length > 600) continue;
        if (!/\b(vs|v\.)\b/i.test(txt)) continue;
        const odds = txt.match(/\d{1,2}[.,]\d{1,2}/g) || [];
        if (!odds.length) continue;
        const key = `${txt.slice(0, 120)}__${odds.slice(0, 6).join(",")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cards.push({
          selector,
          text: txt.slice(0, 350),
          odds: odds.slice(0, 12),
          classes: node.className || ""
        });
        if (cards.length >= 250) break;
      }
      if (cards.length >= 250) break;
    }

    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,[role='heading']")).map((el) => (el.textContent || "").trim()).filter(Boolean).slice(0, 120);

    return {
      title: document.title,
      url: location.href,
      linesTop: lines.slice(0, 250),
      headings,
      candidateCards: cards,
      totalElements: document.querySelectorAll("*").length
    };
  });

  const interesting = getInterestingLines(debug.linesTop);
  const txtOut = [
    `TITLE: ${debug.title}`,
    `FINAL_URL: ${debug.url}`,
    `TOTAL_ELEMENTS: ${debug.totalElements}`,
    "",
    "HEADINGS:",
    ...debug.headings.slice(0, 80),
    "",
    "TOP_INTERESTING_LINES:",
    ...interesting.slice(0, 250),
    "",
    "CANDIDATE_CARDS:",
    ...debug.candidateCards.slice(0, 120).map((c, i) => `${i + 1}. [${c.selector}] ${c.text} | odds=${c.odds.join(",")}`)
  ].join("\n");

  await fs.writeFile(OUT_TXT, txtOut, "utf8");

  console.log(JSON.stringify({
    ok: true,
    title: debug.title,
    finalUrl: debug.url,
    headingCount: debug.headings.length,
    candidateCards: debug.candidateCards.length,
    html: OUT_HTML,
    txt: OUT_TXT,
    png: OUT_PNG
  }, null, 2));
} finally {
  await browser.close();
}
