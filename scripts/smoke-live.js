/**
 * Run: node scripts/smoke-live.js
 * Live smoke-only check (non-deterministic).
 */
const base = process.env.SMOKE_BASE_URL || "http://localhost:3001";
const endpoints = [
  "/health",
  "/api/debug/full-check",
  "/api/pipeline/nike-vs-tipsport"
];

const out = [];
for (const ep of endpoints) {
  try {
    const r = await fetch(`${base}${ep}`);
    out.push({ endpoint: ep, ok: r.ok, status: r.status });
  } catch (err) {
    out.push({ endpoint: ep, ok: false, status: null, error: String(err?.message || err) });
  }
}
console.log(JSON.stringify({ base, smoke: out }, null, 2));

