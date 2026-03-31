const refreshBtn = document.getElementById("refreshBtn");
const updateOddsBtn = document.getElementById("updateOddsBtn");
const lastUpdated = document.getElementById("lastUpdated");
const viewCurrentBtn = document.getElementById("viewCurrentBtn");
const viewLastBtn = document.getElementById("viewLastBtn");
const pageHeader = document.querySelector(".page-header");
const loadingText = document.getElementById("loadingText");
const loadingPercent = document.getElementById("loadingPercent");
const loadingPhase = document.getElementById("loadingPhase");
const loadingBar = document.getElementById("loadingBar");
const loadingDetail = document.getElementById("loadingDetail");
const summaryCards = document.getElementById("summaryCards");
const edgeSearch = document.getElementById("edgeSearch");
const edgeSport = document.getElementById("edgeSport");
const edgeMarket = document.getElementById("edgeMarket");
const edgesTbody = document.querySelector("#edgesTable tbody");
const controlTbody = document.querySelector("#controlTable tbody");
const oppSearch = document.getElementById("oppSearch");
const oppSport = document.getElementById("oppSport");
const oppMarket = document.getElementById("oppMarket");
const oppTbody = document.querySelector("#opportunitiesTable tbody");
const oppLoading = document.getElementById("oppLoading");

let edgesRows = [];
let oppRows = [];
let controlRows = [];
/** Posledný zobrazený snapshot (pre prepnutie na "Last výstup") */
let lastAppliedSnapshot = null;
/** 'current' = živý výstup, 'last' = zmrazený last výstup */
let viewMode = "current";
let loadingTicker = null;
let loadingStartedAt = 0;
let refreshSeq = 0;
const SNAPSHOT_CACHE_KEY = "ui_snapshot_cache_v2";

/** Odhad trvania backendu: prvá polovica = Nike, druhá = Tipsport (ms) */
const ESTIMATE_BACKEND_MS = 100 * 1000;
/** Odhad trvania All 2-Way: prvá polovica Nike dáta, druhá Tipsport (ms) */
const ESTIMATE_OPP_MS = 15 * 1000;
/** Počet hlavných fáz loadingu (Nike, Tipsport, Edges+Control, Opp Nike, Opp Tipsport) */
const LOADING_PHASE_COUNT = 5;
const LOADING_COMPLETE_TEXT = "Načítanie dokončené.";

function setLoading(percentage, text) {
  const value = Math.max(0, Math.min(100, Number(percentage) || 0));
  loadingBar.style.width = `${value}%`;
  loadingPercent.textContent = `${Math.round(value)}%`;
  loadingText.textContent = text || "Loading...";
  if (value >= 100) {
    setLoadingPhase(null);
    const isError = text && (String(text).includes("failed") || String(text).toLowerCase().includes("zlyhal"));
    if (!isError) {
      loadingText.textContent = LOADING_COMPLETE_TEXT;
      setLoadingDetail("Všetky dáta načítané.");
    }
  }
}

/** phase: 1..5 = "Fáza 1/5" … "Fáza 5/5", null/undefined = skryté */
function setLoadingPhase(phase) {
  if (!loadingPhase) return;
  const n = typeof phase === "number" && phase >= 1 && phase <= LOADING_PHASE_COUNT ? phase : 0;
  loadingPhase.textContent = n ? `Fáza ${n}/${LOADING_PHASE_COUNT}` : "";
  loadingPhase.setAttribute("aria-hidden", n ? "false" : "true");
}

function setLoadingDetail(text) {
  loadingDetail.textContent = text || "";
}

function stopLoadingTicker() {
  if (loadingTicker) {
    clearInterval(loadingTicker);
    loadingTicker = null;
  }
}

/**
 * Časovo závislý progress v segmentoch. Každý segment: { durationMs, endPct, phase, label }.
 * startPct pre prvý segment je 0, ďalšie segmenty začínajú na endPct predchádzajúceho.
 * Vráti funkciu stop().
 */
function startPhasedProgress(initialPct, segments) {
  stopLoadingTicker();
  loadingStartedAt = Date.now();
  let lastPhase = 0;
  let lastLabel = "";
  loadingTicker = setInterval(() => {
    const elapsed = Date.now() - loadingStartedAt;
    let acc = 0;
    let startPct = initialPct;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const endMs = acc + seg.durationMs;
      if (elapsed <= endMs) {
        const pct = startPct + (elapsed - acc) / seg.durationMs * (seg.endPct - startPct);
        const value = Math.min(seg.endPct, Math.max(startPct, pct));
        if (seg.phase !== lastPhase) {
          setLoadingPhase(seg.phase);
          lastPhase = seg.phase;
        }
        lastLabel = seg.label;
        setLoading(Math.round(value), seg.label);
        setLoadingDetail(`${seg.label} · prebieha ${Math.round(elapsed / 1000)}s`);
        return;
      }
      acc = endMs;
      startPct = seg.endPct;
    }
    const last = segments[segments.length - 1];
    setLoading(last.endPct, last.label);
    setLoadingDetail(`${last.label} · prebieha ${Math.round(elapsed / 1000)}s`);
  }, 250);
  if (segments.length > 0) {
    setLoadingPhase(segments[0].phase);
    setLoading(initialPct, segments[0].label);
  }
  return () => { stopLoadingTicker(); };
}

/**
 * Jednoduchý časovo závislý progress (jeden segment). phase: 1..5, label text.
 */
function startTimeBasedProgress(startPct, endPct, durationMs, phase, label) {
  return startPhasedProgress(startPct, [{ durationMs, endPct, phase, label }]);
}

/** Starý ticker pre Update odds (krátka operácia) – len plynulý pohyb k maxPercent */
function startLoadingTicker(maxPercent, baseText) {
  stopLoadingTicker();
  loadingStartedAt = Date.now();
  loadingTicker = setInterval(() => {
    const current = Number.parseInt(loadingBar.style.width || "0", 10) || 0;
    const elapsedSec = Math.round((Date.now() - loadingStartedAt) / 1000);
    if (current < maxPercent) setLoading(current + 1, baseText);
    setLoadingDetail(`${baseText} · prebieha ${elapsedSec}s`);
  }, 400);
}

function toText(value) {
  if (value == null) return "";
  return String(value);
}

/** Format ISO date-time for display (DD.MM.YYYY HH:mm) or "-" if missing/invalid */
function formatKickoff(isoOrNull) {
  if (isoOrNull == null || isoOrNull === "") return "-";
  const d = new Date(isoOrNull);
  if (Number.isNaN(d.getTime())) return "-";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${day}.${month}.${year} ${h}:${m}`;
}

/** Renders odd with Flashscore-style trend arrow (up = green, down = red). No symbol when unchanged. */
function oddWithArrow(odd, trend) {
  const text = odd == null || odd === "" ? "-" : String(odd);
  if (trend === "up") return `${text} <span class="odd-arrow odd-up" aria-label="kurz rastol">&#9650;</span>`;
  if (trend === "down") return `${text} <span class="odd-arrow odd-down" aria-label="kurz klesol">&#9660;</span>`;
  return text;
}

function lineText(value) {
  return value == null ? "-" : String(value);
}

function marginBadge(val) {
  if (val == null) return '<span class="margin-na">-</span>';
  const cls =
    val < 5 ? "margin-low" :
    val < 10 ? "margin-mid" :
    val < 15 ? "margin-high" :
    "margin-very-high";
  return `<span class="margin-badge ${cls}">${val.toFixed(2)}%</span>`;
}

function marginDiffBadge(val) {
  if (val == null) return '<span class="margin-na">-</span>';
  const cls = val <= 0 ? "margin-diff-neg" : "margin-diff-pos";
  const sign = val > 0 ? "+" : "";
  return `<span class="margin-badge ${cls}">${sign}${val.toFixed(2)}%</span>`;
}

let lastSummary = null;
let lastUpdatedAt = null;

function showMatchListModal(title, matchTitles) {
  const list = Array.isArray(matchTitles) && matchTitles.length ? matchTitles : ["Žiadne zápasy"];
  const existing = document.getElementById("matchListModal");
  if (existing) existing.remove();
  const modal = document.createElement("div");
  modal.id = "matchListModal";
  modal.className = "match-list-modal";
  modal.innerHTML = `
    <div class="match-list-backdrop"></div>
    <div class="match-list-content">
      <div class="match-list-header">
        <h3>${title}</h3>
        <button type="button" class="match-list-close" aria-label="Zavrieť">×</button>
      </div>
      <ul class="match-list">${list.map((m) => `<li>${toText(m)}</li>`).join("")}</ul>
    </div>`;
  modal.querySelector(".match-list-backdrop").addEventListener("click", () => modal.remove());
  modal.querySelector(".match-list-close").addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);
}

function renderSummary(summary) {
  lastSummary = summary;
  const superPonukaCount = summary.superponukaMatches ?? 0;
  const superSancaCount = summary.superSancaMatches ?? 0;
  const items = [
    ["Super ponuka matches", superPonukaCount, "superPonuka"],
    ["Super šanca matches", superSancaCount, "superSanca"],
    ["Nike emitted markets", summary.nikeEmittedMarkets],
    ["Matched compared rows", summary.matchedComparedRows],
    ["Final edge rows", summary.finalEdgeRows]
  ];
  summaryCards.innerHTML = items
    .map(([label, value, dataKey]) => {
      const isClickable = dataKey === "superPonuka" || dataKey === "superSanca";
      const cardClass = isClickable ? "card card-clickable" : "card";
      const dataAttr = isClickable ? ` data-match-list="${dataKey}"` : "";
      return `<div class="${cardClass}"${dataAttr}><div class="label">${label}</div><div class="value">${value}</div></div>`;
    })
    .join("");
  lastUpdated.textContent = `Last updated: ${summary.updatedAt || "-"}`;
  summaryCards.querySelectorAll(".card-clickable").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.getAttribute("data-match-list");
      const titles = key === "superPonuka" ? (lastSummary?.superPonukaMatchTitles || []) : (lastSummary?.superSancaMatchTitles || []);
      const title = key === "superPonuka" ? "Super ponuka – zápasy" : "Super šanca – zápasy";
      showMatchListModal(title, titles);
    });
  });
}

function renderEdgeFilters(rows) {
  const sports = [...new Set(rows.map((r) => r.sport).filter(Boolean))].sort();
  const markets = [...new Set(rows.map((r) => r.marketType).filter(Boolean))].sort();
  edgeSport.innerHTML = `<option value="">All sports</option>${sports.map((x) => `<option value="${x}">${x}</option>`).join("")}`;
  edgeMarket.innerHTML = `<option value="">All markets</option>${markets.map((x) => `<option value="${x}">${x}</option>`).join("")}`;
}

function renderEdges() {
  const text = edgeSearch.value.trim().toLowerCase();
  const sport = edgeSport.value;
  const market = edgeMarket.value;
  const rows = edgesRows.filter((r) => {
    if (text && !toText(r.match).toLowerCase().includes(text)) return false;
    if (sport && r.sport !== sport) return false;
    if (market && r.marketType !== market) return false;
    return true;
  });
  edgesTbody.innerHTML = rows
    .map((r) => `
      <tr>
        <td>${toText(r.match)}</td>
        <td>${formatKickoff(r.kickoffAt)}</td>
        <td>${toText(r.sport)}</td>
        <td>${toText(r.marketType)}</td>
        <td>${toText(r.selection)}</td>
        <td>${toText(r.period)}</td>
        <td>${lineText(r.line)}</td>
        <td>${oddWithArrow(r.nikeOdd, r.nikeOddTrend)}</td>
        <td>${oddWithArrow(r.tipsportOdd, r.tipsportOddTrend)}</td>
        <td>${toText(r.probabilityEdgePp)}</td>
        <td>${toText(r.diff)}</td>
      </tr>
    `)
    .join("");
}

function renderControl(rows) {
  controlTbody.innerHTML = rows
    .map((r) => `
      <tr>
        <td>${toText(r.match)}</td>
        <td>${formatKickoff(r.kickoffAt)}</td>
        <td>${toText(r.sport)}</td>
        <td>${toText(r.marketType)}</td>
        <td>${toText(r.rawMarketName || "-")}</td>
        <td>${toText(r.selection)}</td>
        <td>${toText(r.period)}</td>
        <td>${lineText(r.line)}</td>
        <td>${oddWithArrow(r.nikeOdd, r.nikeOddTrend)}</td>
        <td>${oddWithArrow(r.tipsportOdd, r.tipsportOddTrend)}</td>
        <td>${toText(r.status)}</td>
        <td>${toText(r.compareReason)}</td>
      </tr>
    `)
    .join("");
}

function renderRowsIncremental(tbody, rows, rowToHtml, { batchSize = 80, delayMs = 25 } = {}) {
  tbody.innerHTML = "";
  if (!Array.isArray(rows) || rows.length === 0) return Promise.resolve();
  let i = 0;
  return new Promise((resolve) => {
    const tick = () => {
      const chunk = rows.slice(i, i + batchSize).map(rowToHtml).join("");
      if (chunk) tbody.insertAdjacentHTML("beforeend", chunk);
      i += batchSize;
      if (i < rows.length) {
        setTimeout(tick, delayMs);
      } else {
        resolve();
      }
    };
    tick();
  });
}

async function renderEdgesIncremental(rows) {
  await renderRowsIncremental(edgesTbody, rows, (r) => `
    <tr>
      <td>${toText(r.match)}</td>
      <td>${formatKickoff(r.kickoffAt)}</td>
      <td>${toText(r.sport)}</td>
      <td>${toText(r.marketType)}</td>
      <td>${toText(r.selection)}</td>
      <td>${toText(r.period)}</td>
      <td>${lineText(r.line)}</td>
      <td>${oddWithArrow(r.nikeOdd, r.nikeOddTrend)}</td>
      <td>${oddWithArrow(r.tipsportOdd, r.tipsportOddTrend)}</td>
      <td>${toText(r.probabilityEdgePp)}</td>
      <td>${toText(r.diff)}</td>
    </tr>
  `, { batchSize: 60, delayMs: 20 });
}

async function renderControlIncremental(rows) {
  await renderRowsIncremental(controlTbody, rows, (r) => `
    <tr>
      <td>${toText(r.match)}</td>
      <td>${formatKickoff(r.kickoffAt)}</td>
      <td>${toText(r.sport)}</td>
      <td>${toText(r.marketType)}</td>
      <td>${toText(r.rawMarketName || "-")}</td>
      <td>${toText(r.selection)}</td>
      <td>${toText(r.period)}</td>
      <td>${lineText(r.line)}</td>
      <td>${oddWithArrow(r.nikeOdd, r.nikeOddTrend)}</td>
      <td>${oddWithArrow(r.tipsportOdd, r.tipsportOddTrend)}</td>
      <td>${toText(r.status)}</td>
      <td>${toText(r.compareReason)}</td>
    </tr>
  `, { batchSize: 90, delayMs: 20 });
}

function renderOpportunityFilters(rows) {
  const sports = [...new Set(rows.map((r) => r.sport).filter(Boolean))].sort();
  const markets = [...new Set(rows.map((r) => r.marketType).filter(Boolean))].sort();
  oppSport.innerHTML = `<option value="">All sports</option>${sports.map((x) => `<option value="${x}">${x}</option>`).join("")}`;
  oppMarket.innerHTML = `<option value="">All markets</option>${markets.map((x) => `<option value="${x}">${x}</option>`).join("")}`;
}

function renderOpportunities() {
  const text = oppSearch.value.trim().toLowerCase();
  const sport = oppSport.value;
  const market = oppMarket.value;
  const rows = oppRows.filter((r) => {
    if (text && !toText(r.match).toLowerCase().includes(text)) return false;
    if (sport && r.sport !== sport) return false;
    if (market && r.marketType !== market) return false;
    return true;
  });
  if (!rows.length) {
    oppTbody.innerHTML = `<tr><td colspan="16" style="text-align:center;color:#6b7280;">Žiadne záznamy.</td></tr>`;
    return;
  }
  oppTbody.innerHTML = rows
    .map((r) => `
      <tr>
        <td>${toText(r.match)}</td>
        <td>${formatKickoff(r.kickoffAt)}</td>
        <td>${toText(r.sport)}</td>
        <td>${toText(r.marketType)}</td>
        <td>${toText(r.rawMarketName || "-")}</td>
        <td>${toText(r.selection)}</td>
        <td>${toText(r.period)}</td>
        <td>${lineText(r.line)}</td>
        <td>${oddWithArrow(r.nikeOdd, r.nikeOddTrend)}</td>
        <td>${oddWithArrow(r.tipsportOdd, r.tipsportOddTrend)}</td>
        <td>${marginBadge(r.nikeMarginPercent)}${r.marginNote ? `<span class="margin-note" title="${r.marginNote}"> ⚠</span>` : ""}</td>
        <td>${marginBadge(r.tipsportMarginPercent)}</td>
        <td>${marginDiffBadge(r.marginDiff)}</td>
        <td>${toText(r.status)}</td>
        <td>${toText(r.compareReason || "-")}</td>
        <td>${toText(r.sourceType || "-")}</td>
      </tr>
    `)
    .join("");
}

/** Vykreslí tabuľky z uloženého snapshotu (pre "Last výstup" bez zmeny edgesRows/oppRows). */
function renderViewFromSnapshot(snapshot) {
  if (!snapshot) return;
  renderSummary(snapshot.summary || {});
  lastUpdated.textContent = `Last updated: ${snapshot.updatedAt || "-"} (Last výstup)`;
  const edgeRows = snapshot.finalEdges?.rows || [];
  const ctrlRows = snapshot.controlTable?.rows || [];
  const oppRowsSnap = snapshot.all2wayRows || [];
  renderEdgeFilters(edgeRows);
  edgesTbody.innerHTML = edgeRows
    .map((r) => `
      <tr>
        <td>${toText(r.match)}</td>
        <td>${formatKickoff(r.kickoffAt)}</td>
        <td>${toText(r.sport)}</td>
        <td>${toText(r.marketType)}</td>
        <td>${toText(r.selection)}</td>
        <td>${toText(r.period)}</td>
        <td>${lineText(r.line)}</td>
        <td>${oddWithArrow(r.nikeOdd, r.nikeOddTrend)}</td>
        <td>${oddWithArrow(r.tipsportOdd, r.tipsportOddTrend)}</td>
        <td>${toText(r.probabilityEdgePp)}</td>
        <td>${toText(r.diff)}</td>
      </tr>
    `)
    .join("");
  controlTbody.innerHTML = ctrlRows
    .map((r) => `
      <tr>
        <td>${toText(r.match)}</td>
        <td>${formatKickoff(r.kickoffAt)}</td>
        <td>${toText(r.sport)}</td>
        <td>${toText(r.marketType)}</td>
        <td>${toText(r.rawMarketName || "-")}</td>
        <td>${toText(r.selection)}</td>
        <td>${toText(r.period)}</td>
        <td>${lineText(r.line)}</td>
        <td>${oddWithArrow(r.nikeOdd, r.nikeOddTrend)}</td>
        <td>${oddWithArrow(r.tipsportOdd, r.tipsportOddTrend)}</td>
        <td>${toText(r.status)}</td>
        <td>${toText(r.compareReason)}</td>
      </tr>
    `)
    .join("");
  renderOpportunityFilters(oppRowsSnap);
  if (!oppRowsSnap.length) {
    oppTbody.innerHTML = `<tr><td colspan="16" style="text-align:center;color:#6b7280;">Žiadne záznamy (Last výstup).</td></tr>`;
  } else {
    oppTbody.innerHTML = oppRowsSnap
      .map((r) => `
        <tr>
          <td>${toText(r.match)}</td>
          <td>${formatKickoff(r.kickoffAt)}</td>
          <td>${toText(r.sport)}</td>
          <td>${toText(r.marketType)}</td>
          <td>${toText(r.rawMarketName || "-")}</td>
          <td>${toText(r.selection)}</td>
          <td>${toText(r.period)}</td>
          <td>${lineText(r.line)}</td>
          <td>${oddWithArrow(r.nikeOdd, r.nikeOddTrend)}</td>
          <td>${oddWithArrow(r.tipsportOdd, r.tipsportOddTrend)}</td>
          <td>${marginBadge(r.nikeMarginPercent)}${r.marginNote ? `<span class="margin-note" title="${r.marginNote}"> ⚠</span>` : ""}</td>
          <td>${marginBadge(r.tipsportMarginPercent)}</td>
          <td>${marginDiffBadge(r.marginDiff)}</td>
          <td>${toText(r.status)}</td>
          <td>${toText(r.compareReason || "-")}</td>
          <td>${toText(r.sourceType || "-")}</td>
        </tr>
      `)
      .join("");
  }
}

/** Prekreslí aktuálny (živý) výstup z edgesRows, controlRows, oppRows. */
function renderCurrentView() {
  renderSummary(lastSummary || {});
  lastUpdated.textContent = `Last updated: ${lastUpdatedAt || "-"}`;
  renderEdges();
  renderControl(controlRows);
  renderOpportunities();
}

function isLoading() {
  return loadingTicker != null;
}

async function applySnapshot(snapshotRes, { seq = refreshSeq } = {}) {
  viewMode = "current";
  updateViewButtons();
  setLoadingPhase(3);
  renderSummary(snapshotRes.summary || {});
  edgesRows = snapshotRes.finalEdges?.rows || [];
  controlRows = snapshotRes.controlTable?.rows || [];
  renderEdgeFilters(edgesRows);
  setLoadingDetail("Pridávam riadky do Final Edges...");
  await renderEdgesIncremental(edgesRows);
  setLoadingDetail("Pridávam riadky do Control Table...");
  await renderControlIncremental(controlRows);
  lastUpdatedAt = snapshotRes.updatedAt || new Date().toISOString();
  lastUpdated.textContent = `Last updated: ${lastUpdatedAt}`;
  lastAppliedSnapshot = {
    summary: snapshotRes.summary || {},
    finalEdges: snapshotRes.finalEdges || { rows: [] },
    controlTable: snapshotRes.controlTable || { rows: [] },
    updatedAt: snapshotRes.updatedAt,
    all2wayRows: []
  };
  try {
    localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshotRes));
  } catch {
    // ignore storage errors
  }

  // Fáza 4 + 5: All 2-Way Opportunities – Nike dáta, potom Tipsport dáta (časovo 4→5)
  if (oppLoading) oppLoading.textContent = "Načítavam All 2-Way Opportunities...";
  const halfOpp = Math.floor(ESTIMATE_OPP_MS / 2);
  const stopOpp = startPhasedProgress(70, [
    { durationMs: halfOpp, endPct: 84, phase: 4, label: "All 2-Way – Nike zápasy a kurzy" },
    { durationMs: halfOpp, endPct: 98, phase: 5, label: "All 2-Way – Tipsport porovnanie" }
  ]);
  try {
    const oppRes = await fetch("/api/ui/all-2way-opportunities").then((r) => r.json());
    if (seq !== refreshSeq) return;
    stopOpp();
    if (oppRes.ok) {
      oppRows = oppRes.rows || [];
      if (lastAppliedSnapshot) lastAppliedSnapshot.all2wayRows = oppRows;
      renderOpportunityFilters(oppRows);
      renderOpportunities();
      if (oppLoading) oppLoading.textContent = "";
      setLoading(100, LOADING_COMPLETE_TEXT);
      setLoadingDetail("Všetky dáta načítané.");
      return;
    }
    if (oppLoading) oppLoading.textContent = `Chyba: ${oppRes.error || "neznáma"}`;
    setLoadingDetail("All 2-Way zlyhalo.");
    setLoading(100, "Refresh complete with warnings.");
  } catch (err) {
    if (seq !== refreshSeq) return;
    stopOpp();
    if (oppLoading) oppLoading.textContent = `Chyba načítania opportunities: ${err.message || err}`;
    setLoadingDetail("All 2-Way zlyhalo.");
    setLoading(100, "Refresh complete with warnings.");
  } finally {
    stopLoadingTicker();
    setLoadingPhase(null);
  }
}

async function loadLastSnapshotOnOpen() {
  try {
    const res = await fetch("/api/ui/last-snapshot").then((r) => r.json());
    if (!res.ok) return false;
    setLoading(20, "Loaded last snapshot.");
    setLoadingDetail("Zobrazené posledné načítanie z backend cache.");
    await applySnapshot(res, { seq: refreshSeq });
    setLoading(100, "Ready.");
    return true;
  } catch {
    return false;
  }
}

async function updateOddsOnly() {
  const seq = ++refreshSeq;
  updateOddsBtn.disabled = true;
  refreshBtn.disabled = true;
  setLoadingPhase(null);
  setLoading(10, "Updating odds only...");
  startLoadingTicker(90, "Update odds (bez reloadu zápasov)");
  setLoadingDetail("Aktualizujem len kurzy pre už načítané zápasy...");
  try {
    const res = await fetch("/api/ui/update-odds", { method: "POST" }).then((r) => r.json());
    stopLoadingTicker();
    if (!res.ok) {
      throw new Error(res.error || "update-odds failed");
    }
    setLoading(92, "Rendering updated odds...");
    await applySnapshot(res, { seq });
    setLoading(100, "Odds updated.");
    setLoadingDetail("Kurzy boli aktualizované bez plného reloadu zápasov.");
  } catch (err) {
    stopLoadingTicker();
    setLoading(100, `Update failed: ${err.message || err}`);
    setLoadingDetail("Nepodarilo sa aktualizovať kurzy.");
    alert(`Update odds failed: ${err.message || err}`);
  } finally {
    stopLoadingTicker();
    updateOddsBtn.disabled = false;
    refreshBtn.disabled = false;
  }
}

async function loadAll() {
  const seq = ++refreshSeq;
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Refreshing...";
  setLoadingPhase(null);
  setLoading(5, "Starting refresh...");
  setLoadingDetail("Prvé načítanie môže trvať 1–2 minúty (škrabanie Nike + Flashscore). Čakajte prosím.");
  if (oppLoading) oppLoading.textContent = "Načítavam...";
  try {
    // SWR: show cached snapshot immediately (if <30min old), then refresh in background.
    try {
      const cachedRaw = localStorage.getItem(SNAPSHOT_CACHE_KEY);
      if (cachedRaw && seq === refreshSeq) {
        const cached = JSON.parse(cachedRaw);
        const cacheAgeMin = cached?.updatedAt ? (Date.now() - new Date(cached.updatedAt).getTime()) / 60000 : 999;
        if (cached?.summary && cached?.finalEdges?.rows && cached?.controlTable?.rows && cacheAgeMin < 30) {
          renderSummary(cached.summary || {});
          edgesRows = cached.finalEdges?.rows || [];
          renderEdgeFilters(edgesRows);
          await renderEdgesIncremental(edgesRows);
          if (seq !== refreshSeq) return; // abort if superseded
          await renderControlIncremental(cached.controlTable?.rows || []);
          if (seq !== refreshSeq) return;
          setLoading(12, "Zobrazené posledné uložené dáta. Aktualizujem...");
          setLoadingDetail("Beží aktualizácia na pozadí (fresh dáta).");
        }
      }
    } catch {
      // ignore cache parse errors
    }

    const halfBackend = Math.floor(ESTIMATE_BACKEND_MS / 2);
    const stopBackend = startPhasedProgress(15, [
      { durationMs: halfBackend, endPct: 35, phase: 1, label: "Nike – zápasy a kurzy" },
      { durationMs: halfBackend, endPct: 70, phase: 2, label: "Tipsport – porovnanie kurzov" }
    ]);

    const snapshotRes = await fetch("/api/ui/snapshot").then((r) => r.json());

    stopBackend();
    setLoading(70, "Final Edges + Control...");
    setLoadingPhase(3);
    setLoadingDetail("Renderujem tabuľky...");

    if (!snapshotRes.ok) {
      throw new Error(snapshotRes.error || "UI snapshot endpoint error");
    }

    await applySnapshot(snapshotRes, { seq });

    lastUpdated.textContent = `Last updated: ${snapshotRes.updatedAt || new Date().toISOString()}`;
  } catch (err) {
    stopLoadingTicker();
    setLoading(100, `Load failed: ${err.message || err}`);
    setLoadingDetail("Skontroluj, či backend beží a zopakuj Refresh.");
    if (oppLoading) oppLoading.textContent = `Chyba načítania: ${err.message || err}`;
    alert(`Load failed: ${err.message || err}`);
  } finally {
    stopLoadingTicker();
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh";
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    document.getElementById("edgesTab").classList.toggle("active", tab === "edges");
    document.getElementById("controlTab").classList.toggle("active", tab === "control");
    document.getElementById("opportunitiesTab").classList.toggle("active", tab === "opportunities");
    document.getElementById("lubosTab").classList.toggle("active", tab === "lubos");
  });
});

function updateViewButtons() {
  if (!viewCurrentBtn || !viewLastBtn) return;
  const isCurrent = viewMode === "current";
  viewCurrentBtn.classList.toggle("active", isCurrent);
  viewCurrentBtn.setAttribute("aria-pressed", isCurrent);
  viewLastBtn.classList.toggle("active", !isCurrent);
  viewLastBtn.setAttribute("aria-pressed", !isCurrent);
}

function showLastView() {
  if (lastAppliedSnapshot) {
    viewMode = "last";
    renderViewFromSnapshot(lastAppliedSnapshot);
    updateViewButtons();
  } else {
    alert("Ešte nebol načítaný žiadny výstup. Stlačte Refresh.");
  }
}

function showCurrentView() {
  viewMode = "current";
  renderCurrentView();
  updateViewButtons();
}

viewCurrentBtn?.addEventListener("click", () => {
  if (viewMode === "current") return;
  showCurrentView();
});

viewLastBtn?.addEventListener("click", () => {
  if (isLoading()) {
    const u = new URL(window.location.href);
    u.searchParams.set("view", "last");
    window.open(u.toString(), "_blank", "noopener");
    return;
  }
  showLastView();
});

refreshBtn.addEventListener("click", loadAll);
updateOddsBtn.addEventListener("click", updateOddsOnly);
edgeSearch.addEventListener("input", () => { if (viewMode === "current") renderEdges(); });
edgeSport.addEventListener("change", () => { if (viewMode === "current") renderEdges(); });
edgeMarket.addEventListener("change", () => { if (viewMode === "current") renderEdges(); });
oppSearch.addEventListener("input", () => { if (viewMode === "current") renderOpportunities(); });
oppSport.addEventListener("change", () => { if (viewMode === "current") renderOpportunities(); });
oppMarket.addEventListener("change", () => { if (viewMode === "current") renderOpportunities(); });

/** Otvorí stránku ako "last-only" okno: načíta last-snapshot a zobrazí ho, skryje toolbar a view switcher. */
async function openAsLastOnlyWindow() {
  if (pageHeader) pageHeader.style.display = "none";
  const toolbar = document.querySelector(".toolbar");
  if (toolbar) toolbar.style.display = "none";
  const loadingPanel = document.getElementById("loadingPanel");
  if (loadingPanel) loadingPanel.style.display = "none";
  document.title = "Last výstup – Nike vs Tipsport";
  try {
    const res = await fetch("/api/ui/last-snapshot").then((r) => r.json());
    if (!res.ok) throw new Error(res.error || "last-snapshot failed");
    const snap = {
      summary: res.summary || {},
      finalEdges: res.finalEdges || { rows: [] },
      controlTable: res.controlTable || { rows: [] },
      updatedAt: res.updatedAt,
      all2wayRows: []
    };
    try {
      const oppRes = await fetch("/api/ui/all-2way-opportunities").then((r) => r.json());
      if (oppRes?.ok && Array.isArray(oppRes.rows)) {
        snap.all2wayRows = oppRes.rows;
      } else {
        document.body.insertAdjacentHTML("afterbegin",
          `<p class="last-window-warning" style="background:#fef3cd;color:#856404;padding:8px 12px;margin:0;font-size:13px;">⚠ All 2-Way dáta nemusia byť aktuálne – v pozadí prebieha refresh.</p>`);
      }
    } catch {
      document.body.insertAdjacentHTML("afterbegin",
        `<p class="last-window-warning" style="background:#fef3cd;color:#856404;padding:8px 12px;margin:0;font-size:13px;">⚠ All 2-Way dáta sa nepodarilo načítať – snapshot môže byť neúplný.</p>`);
    }
    renderViewFromSnapshot(snap);
  } catch (err) {
    document.body.insertAdjacentHTML("beforeend", `<p class="last-window-error">Načítanie zlyhalo: ${err.message || err}</p>`);
  }
}

(async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "last") {
    await openAsLastOnlyWindow();
    return;
  }
  const shown = await loadLastSnapshotOnOpen();
  if (shown) {
    // Even if last-snapshot was shown, check if it's old (>10min) and auto-refresh.
    try {
      const cachedRaw = localStorage.getItem(SNAPSHOT_CACHE_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        const updatedMs = cached?.updatedAt ? new Date(cached.updatedAt).getTime() : 0;
        const ageMin = (Date.now() - updatedMs) / 60000;
        if (ageMin > 10) {
          setLoadingDetail(`Posledné dáta sú ${Math.round(ageMin)} min staré. Automatický refresh...`);
          await loadAll();
        }
      }
    } catch { /* ignore */ }
  } else {
    await loadAll();
  }
})();
