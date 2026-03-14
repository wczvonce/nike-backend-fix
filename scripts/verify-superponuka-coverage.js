import process from "node:process";

const base = process.env.VERIFY_BASE_URL || "http://localhost:3001";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

const nikeDebug = await fetch(`${base}/api/debug/nike`).then((r) => r.json());
const full = await fetch(`${base}/api/debug/full-check`).then((r) => r.json());

if (!nikeDebug?.ok) fail(`debug/nike failed: ${JSON.stringify(nikeDebug)}`);
if (!full?.ok) fail(`debug/full-check failed: ${JSON.stringify(full)}`);

const candidate = Number(nikeDebug?.parserDebug?.candidateCardsCount || 0);
const uniqueCandidate = Number(nikeDebug?.parserDebug?.candidateUniqueMatchCount || 0);
const parsed = Number(nikeDebug?.parserDebug?.parsedMatchesCount || 0);
if (parsed <= 0) fail("no parsed Superponuka matches");
if (candidate > 0 && parsed > candidate) fail(`parsed matches (${parsed}) exceeds candidates (${candidate})`);
if (uniqueCandidate > 0 && parsed > uniqueCandidate) fail(`parsed matches (${parsed}) exceeds unique candidates (${uniqueCandidate})`);

const significantGap = candidate >= 4 && parsed <= candidate - 2;
const uniqueGap = uniqueCandidate >= 4 && parsed <= uniqueCandidate - 1;
if (significantGap || uniqueGap) {
  fail(`Superponuka appears partial: candidates=${candidate}, uniqueCandidates=${uniqueCandidate}, parsed=${parsed}`);
}

if (full.status === "PASS" && (significantGap || uniqueGap)) {
  fail("QA contradiction: PASS while Superponuka parser appears partial");
}

console.log(`OK: Superponuka coverage checks passed (candidates=${candidate}, uniqueCandidates=${uniqueCandidate}, parsed=${parsed})`);

