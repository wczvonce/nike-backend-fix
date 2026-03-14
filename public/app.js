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

let edgesRows = [];
let loadingTicker = null;
let loadingStartedAt = 0;

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

function lineText(value) {
  return value == null ? "-" : String(value);
}

function renderSummary(summary) {
  const items = [
    ["Superponuka matches", summary.superponukaMatches],
    ["Nike emitted markets", summary.nikeEmittedMarkets],
    ["Matched compared rows", summary.matchedComparedRows],
    ["Final edge rows", summary.finalEdgeRows]
  ];
  summaryCards.innerHTML = items
    .map(([label, value]) => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join("");
  lastUpdated.textContent = `Last updated: ${summary.updatedAt || "-"}`;
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
        <td>${toText(r.kickoffAt || "-")}</td>
        <td>${toText(r.sport)}</td>
        <td>${toText(r.marketType)}</td>
        <td>${toText(r.selection)}</td>
        <td>${toText(r.period)}</td>
        <td>${lineText(r.line)}</td>
        <td>${toText(r.nikeOdd)}</td>
        <td>${toText(r.tipsportOdd)}</td>
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
        <td>${toText(r.kickoffAt || "-")}</td>
        <td>${toText(r.sport)}</td>
        <td>${toText(r.marketType)}</td>
        <td>${toText(r.rawMarketName || "-")}</td>
        <td>${toText(r.selection)}</td>
        <td>${toText(r.period)}</td>
        <td>${lineText(r.line)}</td>
        <td>${toText(r.nikeOdd ?? "-")}</td>
        <td>${toText(r.tipsportOdd ?? "-")}</td>
        <td>${toText(r.status)}</td>
        <td>${toText(r.compareReason)}</td>
      </tr>
    `)
    .join("");
}

async function loadAll() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Refreshing...";
  setLoading(5, "Starting refresh...");
  setLoadingDetail("Pripravujem požiadavku...");
  try {
    setLoading(15, "Loading live pipeline...");
    setLoadingDetail("Načítavam summary + final edges + control table v jednom kroku...");
    startLoadingTicker(85, "Backend scraping + porovnanie");
    const snapshotRes = await fetch("/api/ui/snapshot?force=1").then((r) => r.json());
    stopLoadingTicker();
    setLoading(90, "Rendering tables...");
    if (!snapshotRes.ok) {
      throw new Error(snapshotRes.error || "UI snapshot endpoint error");
    }
    renderSummary(snapshotRes.summary || {});
    edgesRows = snapshotRes.finalEdges?.rows || [];
    renderEdgeFilters(edgesRows);
    renderEdges();
    renderControl(snapshotRes.controlTable?.rows || []);
    setLoadingDetail("Dáta načítané úspešne.");
    setLoading(100, "Refresh complete.");
  } catch (err) {
    stopLoadingTicker();
    setLoading(100, `Load failed: ${err.message || err}`);
    setLoadingDetail("Skontroluj, či backend beží a zopakuj Refresh.");
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
  });
});

refreshBtn.addEventListener("click", loadAll);
edgeSearch.addEventListener("input", renderEdges);
edgeSport.addEventListener("change", renderEdges);
edgeMarket.addEventListener("change", renderEdges);

loadAll();

