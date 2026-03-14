/**
 * Run: node scripts/test-normalize.js
 * Verifies odds parsing and normalization (no Playwright needed).
 */
import { parseOdd, normalizeTeamName, normalizeText, slugifyMarket } from "../src/utils/normalize.js";

let failed = 0;

function ok(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("OK:", msg);
  }
}

function eq(a, b, msg) {
  const pass = a === b || (Number.isNaN(a) && Number.isNaN(b)) || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9);
  if (!pass) {
    console.error("FAIL:", msg, "| expected", b, "got", a);
    failed++;
  } else {
    console.log("OK:", msg);
  }
}

console.log("--- parseOdd ---");
eq(parseOdd("1.85"), 1.85, "1.85");
eq(parseOdd("3,40"), 3.4, "3,40");
eq(parseOdd("12.0"), 12, "12.0");
eq(parseOdd("1.01"), 1.01, "1.01");
eq(parseOdd("50.0"), 50, "50.0");
eq(parseOdd(""), null, "empty string");
eq(parseOdd("abc"), null, "no number");
eq(parseOdd("15.30"), null, "time 15:30 rejected");
eq(parseOdd("14.45"), null, "time 14:45 rejected");
eq(parseOdd("20.00"), null, "time 20:00 rejected");
eq(parseOdd("11.30"), 11.3, "11.30 kept (ambiguous, treat as odd)");
eq(parseOdd("2.30"), 2.3, "odd 2.30 kept");
eq(parseOdd("1.30"), 1.3, "odd 1.30 kept");
eq(parseOdd("9.50"), 9.5, "odd 9.50 kept");
eq(parseOdd("51"), null, "51 out of range");
eq(parseOdd("0.99"), null, "0.99 below range");
eq(parseOdd("123.45"), null, "123.45 no match (regex)");
eq(parseOdd("1.234"), null, "1.234 no match (digit after two decimal places)");
eq(parseOdd("1.2"), 1.2, "1.2 parsed");
eq(parseOdd(null), null, "null");
eq(parseOdd(undefined), null, "undefined");
eq(parseOdd("31.12"), null, "date 31.12 rejected");
eq(parseOdd("28.01"), null, "date 28.01 rejected");
eq(parseOdd("30.06"), null, "date 30.06 rejected");
eq(parseOdd("14.03"), null, "date 14.03 rejected");
eq(parseOdd("2.10"), 2.1, "odd 2.10 kept (not date)");
eq(parseOdd("13.05"), null, "date-like 13.05 rejected by default");
eq(parseOdd("13.05", { rejectDateLike: false }), 13.05, "13.05 can be kept in trusted selector contexts");
eq(parseOdd("14.00", { rejectDateLike: false, rejectTimeLike: false }), 14, "14.00 can be kept in trusted odds contexts");

console.log("--- normalizeTeamName ---");
eq(normalizeTeamName("ŠK Slovan Bratislava"), "sk slovan bratislava", "diacritics");
eq(normalizeTeamName("Newcastle Utd."), "newcastle united", "newcastle utd");
eq(normalizeTeamName("B. Monchengladbach"), "borussia monchengladbach", "gladbach");
eq(normalizeTeamName("St. Pauli"), "saint pauli", "st pauli alias");
eq(normalizeTeamName("Spišská N. Ves"), "spisska nova ves", "spisska alias");
eq(normalizeTeamName("HC Sparta Praha"), "sparta praha", "sparta alias");
eq(normalizeTeamName("Rybakina E."), "rybakina", "rybakina alias");
eq(normalizeTeamName("Svitolina E."), "svitolina", "svitolina alias");
eq(normalizeTeamName("AS Rim"), "as roma", "as rim alias");

console.log("--- normalizeText / slugifyMarket ---");
eq(normalizeText("Double Chance"), "double chance", "normalizeText");
eq(slugifyMarket("Double Chance"), "double_chance", "slugifyMarket");

if (failed > 0) {
  console.error("\nTotal failures:", failed);
  process.exit(1);
}
console.log("\nAll checks passed.");
