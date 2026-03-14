const refreshBtn = document.getElementById("refreshBtn");
const lastUpdated = document.getElementById("lastUpdated");
const summaryCards = document.getElementById("summaryCards");
const edgeSearch = document.getElementById("edgeSearch");
const edgeSport = document.getElementById("edgeSport");
const edgeMarket = document.getElementById("edgeMarket");
const edgesTbody = document.querySelector("#edgesTable tbody");
const controlTbody = document.querySelector("#controlTable tbody");

let edgesRows = [];

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
  try {
    const [summaryRes, edgesRes, controlRes] = await Promise.all([
      fetch("/api/ui/summary").then((r) => r.json()),
      fetch("/api/ui/final-edges").then((r) => r.json()),
      fetch("/api/ui/control-table").then((r) => r.json())
    ]);
    if (!summaryRes.ok || !edgesRes.ok || !controlRes.ok) {
      throw new Error(summaryRes.error || edgesRes.error || controlRes.error || "UI endpoint error");
    }
    renderSummary(summaryRes);
    edgesRows = edgesRes.rows || [];
    renderEdgeFilters(edgesRows);
    renderEdges();
    renderControl(controlRes.rows || []);
  } catch (err) {
    alert(`Load failed: ${err.message || err}`);
  } finally {
    refreshBtn.disabled = false;
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

