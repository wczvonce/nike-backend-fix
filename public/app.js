const refreshBtn = document.getElementById("refreshBtn");
const lastUpdated = document.getElementById("lastUpdated");
const loadingText = document.getElementById("loadingText");
const loadingPercent = document.getElementById("loadingPercent");
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
let loadingTicker = null;
let loadingStartedAt = 0;
let refreshSeq = 0;

function setLoading(percentage, text) {
  const value = Math.max(0, Math.min(100, Number(percentage) || 0));
  loadingBar.style.width = `${value}%`;
  loadingPercent.textContent = `${Math.round(value)}%`;
  loadingText.textContent = text || "Loading...";
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

function startLoadingTicker(maxPercent, baseText) {
  stopLoadingTicker();
  loadingStartedAt = Date.now();
  loadingTicker = setInterval(() => {
    const current = Number.parseInt(loadingBar.style.width || "0", 10) || 0;
    const elapsedSec = Math.round((Date.now() - loadingStartedAt) / 1000);
    if (current < maxPercent) {
      setLoading(current + 1, baseText);
    }
    setLoadingDetail(`${baseText} · prebieha ${elapsedSec}s`);
  }, 500);
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

/** Renders odd with Flashscore-style trend arrow (up = green, down = red, same = gray). trend: "up" | "down" | "same" | null */
function oddWithArrow(odd, trend) {
  const text = odd == null || odd === "" ? "-" : String(odd);
  if (trend === "up") return `${text}<span class="odd-arrow odd-up" aria-label="kurz rástol">▲</span>`;
  if (trend === "down") return `${text}<span class="odd-arrow odd-down" aria-label="kurz klesol">▼</span>`;
  if (trend === "same") return `${text}<span class="odd-arrow odd-same" aria-label="kurz bez zmeny">−</span>`;
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

async function loadAll() {
  const seq = ++refreshSeq;
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Refreshing...";
  setLoading(5, "Starting refresh...");
  setLoadingDetail("Načítavam Final Edges + Control Table...");
  if (oppLoading) oppLoading.textContent = "Načítavam...";
  try {
    setLoading(15, "Loading control and final edges...");
    startLoadingTicker(80, "Backend scraping + porovnanie");

    const snapshotRes = await fetch("/api/ui/snapshot?force=1").then((r) => r.json());

    stopLoadingTicker();
    setLoading(88, "Rendering control + final edges...");

    if (!snapshotRes.ok) {
      throw new Error(snapshotRes.error || "UI snapshot endpoint error");
    }

    renderSummary(snapshotRes.summary || {});
    edgesRows = snapshotRes.finalEdges?.rows || [];
    renderEdgeFilters(edgesRows);
    renderEdges();
    renderControl(snapshotRes.controlTable?.rows || []);

    // Show primary tables immediately; opportunities load in background.
    setLoadingDetail("Control + Final Edges načítané. Dopočítavam All 2-Way Opportunities...");
    setLoading(100, "Refresh complete.");

    // Fire-and-render opportunities in background so UI is responsive sooner.
    fetch("/api/ui/all-2way-opportunities")
      .then((r) => r.json())
      .then((oppRes) => {
        // Ignore stale responses from older refreshes.
        if (seq !== refreshSeq) return;
        if (oppRes.ok) {
          oppRows = oppRes.rows || [];
          renderOpportunityFilters(oppRows);
          renderOpportunities();
          if (oppLoading) oppLoading.textContent = "";
          setLoadingDetail("All 2-Way Opportunities načítané.");
          return;
        }
        if (oppLoading) oppLoading.textContent = `Chyba: ${oppRes.error || "neznáma"}`;
      })
      .catch((err) => {
        if (seq !== refreshSeq) return;
        if (oppLoading) oppLoading.textContent = `Chyba načítania opportunities: ${err.message || err}`;
      });
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
  });
});

refreshBtn.addEventListener("click", loadAll);
edgeSearch.addEventListener("input", renderEdges);
edgeSport.addEventListener("change", renderEdges);
edgeMarket.addEventListener("change", renderEdges);
oppSearch.addEventListener("input", renderOpportunities);
oppSport.addEventListener("change", renderOpportunities);
oppMarket.addEventListener("change", renderOpportunities);

loadAll();
