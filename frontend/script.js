/* ============================================================
   FraudShield AI — shared frontend logic
   ============================================================ */

const API_BASE =
  location.protocol === "file:" ? "http://localhost:8000" : location.origin;

async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.detail || detail;
    } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

/* ---------- helpers ---------- */
function fmt(n) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function money(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function levelColor(level) {
  return level === "HIGH" ? "var(--red)" : level === "MEDIUM" ? "var(--amber)" : "var(--green)";
}

/* count-up animation */
function countUp(el, target, { decimals = 0, suffix = "", duration = 900 } = {}) {
  const start = parseFloat(el.dataset._cur || "0");
  const t0 = performance.now();
  function step(now) {
    const p = Math.min((now - t0) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = start + (target - start) * eased;
    el.textContent = val.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }) + suffix;
    if (p < 1) requestAnimationFrame(step);
    else el.dataset._cur = String(target);
  }
  requestAnimationFrame(step);
}

/* loader overlay */
function overlay(show, text) {
  let ov = document.getElementById("overlay");
  if (!ov) return;
  if (text) ov.querySelector(".txt").textContent = text;
  ov.classList.toggle("show", show);
}

/* highlight active nav link */
function markNav() {
  const page = document.body.dataset.page;
  document.querySelectorAll(".nav-links a[data-nav]").forEach((a) => {
    if (a.dataset.nav === page) a.classList.add("active");
  });
}
document.addEventListener("DOMContentLoaded", markNav);

/* ============================================================
   INPUT PAGE
   ============================================================ */
async function initInputPage() {
  const locSel = document.getElementById("location");
  const devSel = document.getElementById("device");
  try {
    const meta = await api("/meta");
    (meta.locations || []).forEach((l) => locSel.add(new Option(l, l)));
    (meta.devices || []).forEach((d) => devSel.add(new Option(d, d)));
  } catch (e) {
    // fallback options so the form still works
    ["New York", "London", "Mumbai", "Lagos", "Moscow", "Sao Paulo"].forEach((l) =>
      locSel.add(new Option(l, l))
    );
    ["Mobile", "Desktop", "Tablet", "POS", "ATM"].forEach((d) =>
      devSel.add(new Option(d, d))
    );
  }

  const form = document.getElementById("txform");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      amount: parseFloat(document.getElementById("amount").value),
      location: locSel.value,
      device: devSel.value,
      time: parseInt(document.getElementById("time").value, 10),
    };
    overlay(true, "🤖 Analyzing Transaction...");
    try {
      const t0 = Date.now();
      const result = await api("/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      // let the loader breathe for the demo feel
      const wait = Math.max(0, 1400 - (Date.now() - t0));
      await new Promise((r) => setTimeout(r, wait));
      sessionStorage.setItem(
        "fs_result",
        JSON.stringify({ ...result, input: payload })
      );
      location.href = "result.html";
    } catch (err) {
      overlay(false);
      alert("Prediction failed: " + err.message);
    }
  });
}

/* ============================================================
   RESULT PAGE
   ============================================================ */
function initResultPage() {
  const raw = sessionStorage.getItem("fs_result");
  if (!raw) {
    document.getElementById("result-root").innerHTML =
      '<div class="glass" style="padding:40px" class="center">No result found. <a href="input.html">Run a prediction</a>.</div>';
    return;
  }
  const r = JSON.parse(raw);
  const isFraud = r.prediction === "Fraud";
  const color = levelColor(r.risk_level);

  const ring = document.getElementById("ring");
  ring.style.background = `conic-gradient(${color} ${r.risk_score * 3.6}deg, rgba(255,255,255,0.08) 0deg)`;
  ring.innerHTML = `<div style="position:absolute;inset:14px;border-radius:50%;background:var(--bg-0);display:grid;place-items:center;flex-direction:column">
      <div class="score" style="color:${color}">0<span style="font-size:1.2rem">%</span></div>
      <div class="pct">risk score</div></div>`;

  const scoreEl = ring.querySelector(".score");
  setTimeout(() => {
    scoreEl.innerHTML = "";
    countUp(scoreEl, r.risk_score, { decimals: 1, suffix: "%" });
  }, 120);

  document.getElementById("verdict-title").textContent = isFraud
    ? "⚠️ Fraud Detected"
    : "✅ Transaction Normal";
  document.getElementById("verdict-title").style.color = isFraud ? "var(--red)" : "var(--green)";

  const lvl = document.getElementById("verdict-level");
  lvl.innerHTML = `<span class="tag ${r.risk_level}" style="font-size:0.95rem;padding:6px 14px">${r.risk_level} RISK</span>`;

  const i = r.input || {};
  document.getElementById("d-amount").textContent = money(i.amount);
  document.getElementById("d-location").textContent = i.location || "—";
  document.getElementById("d-device").textContent = i.device || "—";
  document.getElementById("d-time").textContent =
    i.time != null ? String(i.time).padStart(2, "0") + ":00" : "—";
}

/* ============================================================
   DASHBOARD
   ============================================================ */
let donutChart, lineChart, dsRiskChart, dsRatioChart;
let lastFraudCount = null;

function makeStat(id, value, opts) {
  const el = document.getElementById(id);
  if (el) countUp(el, value, opts);
}

async function refreshDashboard() {
  let stats, hourly;
  try {
    [stats, hourly] = await Promise.all([api("/stats"), api("/hourly")]);
  } catch (e) {
    console.error(e);
    return;
  }

  makeStat("stat-total", stats.total_processed);
  makeStat("stat-fraud", stats.fraud_detected);
  makeStat("stat-normal", stats.normal_count);
  makeStat("stat-risk", stats.avg_risk_score, { decimals: 1, suffix: "%" });

  // fraud spike alert: fired when new fraud appears since last refresh
  if (lastFraudCount !== null && stats.fraud_detected > lastFraudCount) {
    const banner = document.getElementById("alert");
    if (banner) {
      const delta = stats.fraud_detected - lastFraudCount;
      banner.querySelector(".msg").innerHTML =
        `<strong>Fraud spike detected!</strong> ${delta} new fraudulent transaction(s) flagged by the model.`;
      banner.classList.add("show");
      clearTimeout(window._alertT);
      window._alertT = setTimeout(() => banner.classList.remove("show"), 6000);
    }
  }
  lastFraudCount = stats.fraud_detected;

  renderDonut(stats.fraud_detected, stats.normal_count);
  renderLine(hourly);
  refreshTable();
}

function renderDonut(fraud, normal) {
  const ctx = document.getElementById("donut");
  if (!ctx) return;
  const data = [fraud, normal];
  if (donutChart) {
    donutChart.data.datasets[0].data = data;
    donutChart.update();
    return;
  }
  donutChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Fraud", "Normal"],
      datasets: [
        {
          data,
          backgroundColor: ["rgba(251,94,126,0.85)", "rgba(52,211,153,0.85)"],
          borderColor: ["#fb5e7e", "#34d399"],
          borderWidth: 2,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      cutout: "68%",
      plugins: { legend: { labels: { color: "#b9b2d0", font: { size: 13 } } } },
      maintainAspectRatio: false,
    },
  });
}

function renderLine(hourly) {
  const ctx = document.getElementById("line");
  if (!ctx) return;
  const labels = hourly.map((h) => String(h.hour).padStart(2, "0"));
  const total = hourly.map((h) => h.total);
  const fraud = hourly.map((h) => h.fraud);
  if (lineChart) {
    lineChart.data.labels = labels;
    lineChart.data.datasets[0].data = total;
    lineChart.data.datasets[1].data = fraud;
    lineChart.update();
    return;
  }
  const g1 = ctx.getContext("2d").createLinearGradient(0, 0, 0, 280);
  g1.addColorStop(0, "rgba(34,211,238,0.45)");
  g1.addColorStop(1, "rgba(34,211,238,0)");
  const g2 = ctx.getContext("2d").createLinearGradient(0, 0, 0, 280);
  g2.addColorStop(0, "rgba(251,94,126,0.45)");
  g2.addColorStop(1, "rgba(251,94,126,0)");
  lineChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Total Traffic",
          data: total,
          borderColor: "#22d3ee",
          backgroundColor: g1,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2.5,
        },
        {
          label: "Fraud",
          data: fraud,
          borderColor: "#fb5e7e",
          backgroundColor: g2,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2.5,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#b9b2d0" } } },
      scales: {
        x: { ticks: { color: "#8b84a3" }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { ticks: { color: "#8b84a3" }, grid: { color: "rgba(255,255,255,0.05)" }, beginAtZero: true },
      },
    },
  });
}

async function refreshTable() {
  const body = document.getElementById("tx-body");
  if (!body) return;
  let rows;
  try {
    rows = await api("/transactions?limit=8");
  } catch (e) {
    return;
  }
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="center muted">No transactions yet. Run a prediction or upload a dataset.</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map((r) => {
      const t = r.time != null ? String(r.time).padStart(2, "0") + ":00" : "—";
      return `<tr>
        <td>${money(r.amount)}</td>
        <td>${r.location ?? "—"}</td>
        <td>${r.device ?? "—"}</td>
        <td>${t}</td>
        <td><span class="tag ${r.prediction === "Fraud" ? "fraud" : "normal"}">${r.prediction}</span></td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="riskbar"><span style="width:${Math.min(r.risk_score, 100)}%"></span></div>
            <span style="min-width:46px;text-align:right">${fmt(r.risk_score)}%</span>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

/* ---- dataset upload ---- */
function initUpload() {
  const zone = document.getElementById("drop");
  const input = document.getElementById("csvfile");
  const btn = document.getElementById("analyze-btn");
  if (!zone) return;
  let file = null;

  zone.addEventListener("click", () => input.click());
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag");
    file = e.dataTransfer.files[0];
    showFile();
  });
  input.addEventListener("change", () => {
    file = input.files[0];
    showFile();
  });
  function showFile() {
    if (file) {
      document.getElementById("fname").textContent = "📄 " + file.name;
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", async () => {
    if (!file) return;
    overlay(true, "🤖 Analyzing Dataset...");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const t0 = Date.now();
      const r = await api("/analyze-dataset", { method: "POST", body: fd });
      await new Promise((res) => setTimeout(res, Math.max(0, 1200 - (Date.now() - t0))));
      overlay(false);
      renderDatasetResult(r);
      refreshDashboard();
    } catch (err) {
      overlay(false);
      alert("Dataset analysis failed: " + err.message);
    }
  });
}

function renderDatasetResult(r) {
  const panel = document.getElementById("ds-result");
  panel.classList.add("show");
  panel.style.display = "block";
  panel.classList.add("fade-in");

  document.getElementById("ds-total").textContent = fmt(r.total_records);
  document.getElementById("ds-fraud").textContent = fmt(r.fraud_count);
  document.getElementById("ds-pct").textContent = fmt(r.fraud_percentage) + "%";
  document.getElementById("ds-risk").textContent = fmt(r.avg_risk_score) + "%";

  // top 5 table
  document.getElementById("ds-top-body").innerHTML = r.high_risk_transactions
    .map((t, i) => {
      const tm = t.time != null ? String(t.time).padStart(2, "0") + ":00" : "—";
      return `<tr>
        <td>#${i + 1}</td>
        <td>${money(t.amount)}</td>
        <td>${t.location ?? "—"}</td>
        <td>${t.device ?? "—"}</td>
        <td>${tm}</td>
        <td><span class="tag ${t.risk_level}">${t.risk_level}</span></td>
        <td style="text-align:right;font-weight:700;color:${levelColor(t.risk_level)}">${fmt(t.risk_score)}%</td>
      </tr>`;
    })
    .join("");

  // ratio donut
  const ratioCtx = document.getElementById("ds-ratio");
  if (dsRatioChart) dsRatioChart.destroy();
  dsRatioChart = new Chart(ratioCtx, {
    type: "doughnut",
    data: {
      labels: ["Fraud", "Normal"],
      datasets: [
        {
          data: [r.fraud_count, r.normal_count],
          backgroundColor: ["rgba(251,94,126,0.85)", "rgba(52,211,153,0.85)"],
          borderColor: ["#fb5e7e", "#34d399"],
          borderWidth: 2,
        },
      ],
    },
    options: { cutout: "66%", maintainAspectRatio: false, plugins: { legend: { labels: { color: "#b9b2d0" } } } },
  });

  // risk distribution by level (derived from top + counts)
  const distCtx = document.getElementById("ds-risk-dist");
  const levels = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  r.high_risk_transactions.forEach((t) => (levels[t.risk_level] = (levels[t.risk_level] || 0) + 1));
  // approximate full distribution: show fraud vs normal split as risk bands
  if (dsRiskChart) dsRiskChart.destroy();
  dsRiskChart = new Chart(distCtx, {
    type: "bar",
    data: {
      labels: ["Normal", "Fraud"],
      datasets: [
        {
          label: "Transactions",
          data: [r.normal_count, r.fraud_count],
          backgroundColor: ["rgba(52,211,153,0.7)", "rgba(251,94,126,0.7)"],
          borderColor: ["#34d399", "#fb5e7e"],
          borderWidth: 2,
          borderRadius: 8,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8b84a3" }, grid: { display: false } },
        y: { ticks: { color: "#8b84a3" }, grid: { color: "rgba(255,255,255,0.05)" }, beginAtZero: true },
      },
    },
  });
}

function downloadReport() {
  window.open(API_BASE + "/report", "_blank");
}

function initDashboard() {
  refreshDashboard();
  initUpload();
  setInterval(refreshDashboard, 4000); // auto-refresh every 4s
  const dl = document.getElementById("download-btn");
  if (dl) dl.addEventListener("click", downloadReport);
}
