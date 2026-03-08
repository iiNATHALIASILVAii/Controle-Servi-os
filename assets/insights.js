// ====== CONFIG ======
const SUPABASE_URL = "https://cqivhdtncczqusivydkp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vORmTkgLIbtGQWbU6reAKQ_FslPufXi";
// =======================================

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const brl = (v) => (v == null || Number.isNaN(v)) ? "-" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "-";
const safeLower = (x) => (x ?? "").toString().toLowerCase();

const COLORS = {
  teal: "#135352",
  lime: "#A3C72E",
  gray: "#9D9D9C",
  dark: "#575756",
};

Chart.defaults.font.family = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
Chart.defaults.plugins.legend.labels.boxWidth = 12;

function applyChartTheme() {
  const theme = document.documentElement.dataset.theme || "dark";
  const isLight = theme === "light";

  Chart.defaults.color = isLight ? "rgba(11,18,32,.80)" : "rgba(234,242,255,.78)";
  Chart.defaults.borderColor = isLight ? "rgba(11,18,32,.10)" : "rgba(255,255,255,.10)";
}
applyChartTheme();

let RAW = { services: [], farmsById: new Map(), categoriesById: new Map() };
let charts = {};

function extractRdCode(opportunityName) {
  const m = (opportunityName || "").trim().match(/^(\d+)/);
  return m ? m[1] : "";
}
function monthKey(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : "Sem data";
}
function sum(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

async function guard() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) window.location.href = "./index.html";
  const who = $("who");
  if (who) who.textContent = `Logado como: ${session.user?.email || "(sem email)"}`;
}

async function loadLookups() {
  // expense categories
  const cat = await sb.from("expense_categories").select("id,name").order("name", { ascending: true });
  if (cat.error) console.warn(cat.error.message);
  (cat.data || []).forEach(c => RAW.categoriesById.set(c.id, c.name));

  // farms (pra centro de custo)
  const farms = await sb.from("farms").select("id,protheus_cost_center").order("name", { ascending: true });
  if (farms.error) console.warn(farms.error.message);
  (farms.data || []).forEach(f => RAW.farmsById.set(f.id, f));
}

async function loadData() {
  const r = await sb
    .from("services")
    .select(`
      id,status,deleted_at,farm_id,
      service_date,client_code,opportunity_name,farm_name,city,state,
      technician,service_type,bu,
      gross_value,tax_value,budget_net,realized,accuracy_pct,
      execution_type,training_hours,travel_hours,remote_hours,on_site_days,
      notes,
      service_products(product,quantity),
      service_expenses(category_id,amount,expense_date)
    `)
    .is("deleted_at", null)
    .order("service_date", { ascending: false });

  if (r.error) {
    alert("Erro lendo services: " + r.error.message);
    return;
  }

  RAW.services = r.data || [];
  buildFilters();
  rebuild();
}

function buildFilters() {
  const monthEl = $("monthFilter");
  const techEl = $("techFilter");
  const typeEl = $("typeFilter");
  const stateEl = $("stateFilter");

  const months = Array.from(new Set(RAW.services.map(s => monthKey(s.service_date)))).sort();
  if (monthEl) monthEl.innerHTML = ['<option value="">Todos os meses</option>']
    .concat(months.map(m => `<option value="${m}">${m}</option>`)).join("");

  const techs = Array.from(new Set(RAW.services.map(s => s.technician || "A definir"))).sort();
  if (techEl) techEl.innerHTML = ['<option value="">Todos os técnicos</option>']
    .concat(techs.map(t => `<option value="${t}">${t}</option>`)).join("");

  const types = Array.from(new Set(RAW.services.map(s => s.service_type || "(vazio)"))).sort();
  if (typeEl) typeEl.innerHTML = ['<option value="">Todos os tipos</option>']
    .concat(types.map(t => `<option value="${t}">${t}</option>`)).join("");

  const states = Array.from(new Set(RAW.services.map(s => s.state || "(vazio)"))).sort();
  if (stateEl) stateEl.innerHTML = ['<option value="">Todos os estados</option>']
    .concat(states.map(s => `<option value="${s}">${s}</option>`)).join("");
}

function getFiltered() {
  const m = $("monthFilter")?.value || "";
  const t = $("techFilter")?.value || "";
  const ty = $("typeFilter")?.value || "";
  const st = $("stateFilter")?.value || "";

  const clientCode = safeLower($("clientCodeFilter")?.value).trim();
  const rdCode = safeLower($("rdCodeFilter")?.value).trim();
  const cc = safeLower($("ccFilter")?.value).trim();
  const q = safeLower($("search")?.value).trim();

  return RAW.services.filter(s => {
    if (m && monthKey(s.service_date) !== m) return false;
    if (t && (s.technician || "A definir") !== t) return false;
    if (ty && (s.service_type || "(vazio)") !== ty) return false;
    if (st && (s.state || "(vazio)") !== st) return false;

    if (clientCode && !safeLower(s.client_code).includes(clientCode)) return false;

    if (rdCode) {
      const rd = safeLower(extractRdCode(s.opportunity_name));
      const opp = safeLower(s.opportunity_name);
      if (!rd.includes(rdCode) && !opp.includes(rdCode)) return false;
    }

    if (cc) {
      const f = s.farm_id ? RAW.farmsById.get(s.farm_id) : null;
      const ccVal = safeLower(f?.protheus_cost_center);
      if (!ccVal.includes(cc)) return false;
    }

    if (!q) return true;

    const blob = [
      s.client_code, s.opportunity_name, s.farm_name, s.city, s.state,
      s.technician, s.service_type, s.bu, s.notes
    ].filter(Boolean).join(" ").toLowerCase();

    return blob.includes(q);
  });
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); charts[key] = null; }
}

function safeCanvas(id) {
  const el = $(id);
  return el instanceof HTMLCanvasElement ? el : null;
}

function rebuild() {
  const rows = getFiltered();

  const rowsBadge = $("rowsBadge");
  if (rowsBadge) rowsBadge.textContent = rows.length;

  const rowCount = $("rowCount");
  if (rowCount) rowCount.textContent = `${rows.length} serviços no filtro`;

  // custo total real = soma service_expenses.amount
  const totalCost = sum(rows.flatMap(s => (s.service_expenses || []).map(e => e.amount)));
  const totalBudget = sum(rows.map(s => s.budget_net));
  const totalRealizedField = sum(rows.map(s => s.realized));

  // acurácia meta ±25%
  const accRows = rows.filter(s => s.accuracy_pct != null && Number.isFinite(Number(s.accuracy_pct)));
  const within = accRows.filter(s => Math.abs(Number(s.accuracy_pct)) <= 25).length;
  const out = accRows.filter(s => Math.abs(Number(s.accuracy_pct)) > 25).length;
  const withinPct = accRows.length ? (within / accRows.length) * 100 : null;

  // horas (treinamento)
  const totalTrainingHours = sum(rows.map(s => s.training_hours));
  const totalRemoteHours = sum(rows.map(s => s.remote_hours));
  const totalTravelHours = sum(rows.map(s => s.travel_hours));
  const totalOnSiteDays = sum(rows.map(s => s.on_site_days));

  // KPI grid
  const kpiGrid = $("kpiGrid");
  if (kpiGrid) {
    kpiGrid.innerHTML = [
      { label: "Custo total (despesas)", value: brl(totalCost), foot: "Soma de service_expenses.amount" },
      { label: "Orçamento total", value: brl(totalBudget), foot: "Soma do budget_net" },
      { label: "Saldo (orçamento - despesas)", value: brl(totalBudget - totalCost), foot: "orçamento - despesas" },
      { label: "Qtd serviços", value: rows.length, foot: "No filtro atual" },
      { label: "Dentro da meta (±25%)", value: withinPct != null ? withinPct.toFixed(1) + "%" : "-", foot: `${within} dentro • ${out} fora (de ${accRows.length})` },
      { label: "Horas (treinamento)", value: totalTrainingHours ? totalTrainingHours.toFixed(1) + "h" : "-", foot: `Remoto: ${totalRemoteHours.toFixed(1)}h • Viagem: ${totalTravelHours.toFixed(1)}h • Dias: ${totalOnSiteDays.toFixed(1)}` },
    ].map(k => `
      <div class="kpi">
        <div class="kpiLabel">${k.label}</div>
        <div class="kpiValue">${k.value}</div>
        <div class="kpiFoot">${k.foot}</div>
      </div>
    `).join("");
  }

  // ===== Charts =====

  // 1) Gastos por categoria
  const byCat = new Map();
  for (const s of rows) {
    for (const e of (s.service_expenses || [])) {
      const name = RAW.categoriesById.get(e.category_id) || `Categoria ${e.category_id}`;
      byCat.set(name, (byCat.get(name) || 0) + (Number(e.amount) || 0));
    }
  }
  const catLabels = Array.from(byCat.keys()).sort((a, b) => byCat.get(b) - byCat.get(a));
  const catVals = catLabels.map(k => byCat.get(k));

  const c1 = safeCanvas("chartExpByCat");
  if (c1) {
    destroyChart("expByCat");
    charts.expByCat = new Chart(c1, {
      type: "doughnut",
      data: { labels: catLabels, datasets: [{ label: "Gastos", data: catVals }] },
      options: { responsive: true, plugins: { legend: { position: "bottom" } } }
    });
  }

  // 2) Gastos por categoria por mês (stack)
  const months = Array.from(new Set(rows.map(s => monthKey(s.service_date)))).sort();
  const catOrder = Array.from(new Set(catLabels));

  const mtx = new Map(catOrder.map(c => [c, new Map(months.map(m => [m, 0]))]));
  for (const s of rows) {
    const m = monthKey(s.service_date);
    for (const e of (s.service_expenses || [])) {
      const c = RAW.categoriesById.get(e.category_id) || `Categoria ${e.category_id}`;
      if (!mtx.has(c)) mtx.set(c, new Map(months.map(mm => [mm, 0])));
      mtx.get(c).set(m, (mtx.get(c).get(m) || 0) + (Number(e.amount) || 0));
    }
  }

  const colorPool = [COLORS.lime, COLORS.teal, COLORS.gray, COLORS.dark, "rgba(163,199,46,.35)", "rgba(19,83,82,.35)"];
  const dsCatMonth = catOrder.map((c, i) => ({
    label: c,
    data: months.map(m => mtx.get(c)?.get(m) || 0),
    backgroundColor: colorPool[i % colorPool.length],
    borderColor: Chart.defaults.borderColor,
    borderWidth: 1
  }));

  const c2 = safeCanvas("chartExpCatMonth");
  if (c2) {
    destroyChart("expCatMonth");
    charts.expCatMonth = new Chart(c2, {
      type: "bar",
      data: { labels: months, datasets: dsCatMonth },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom" } },
        scales: {
          x: { stacked: true, grid: { color: Chart.defaults.borderColor } },
          y: { stacked: true, grid: { color: Chart.defaults.borderColor } }
        }
      }
    });
  }

  // 3) Custo por produto (rateio proporcional à quantidade)
  const byProdCost = new Map();
  for (const s of rows) {
    const serviceCost = sum((s.service_expenses || []).map(e => e.amount));
    if (serviceCost <= 0) continue;

    const prods = (s.service_products || [])
      .map(p => ({ product: p.product || "—", qty: Number(p.quantity) || 0 }))
      .filter(x => x.qty > 0);

    const totalQty = sum(prods.map(x => x.qty));

    if (totalQty <= 0) {
      byProdCost.set("Sem produto", (byProdCost.get("Sem produto") || 0) + serviceCost);
      continue;
    }

    for (const p of prods) {
      const w = p.qty / totalQty;
      byProdCost.set(p.product, (byProdCost.get(p.product) || 0) + (serviceCost * w));
    }
  }

  const prodLabels = Array.from(byProdCost.keys()).sort((a, b) => byProdCost.get(b) - byProdCost.get(a)).slice(0, 12);
  const prodVals = prodLabels.map(p => byProdCost.get(p));

  const c3 = safeCanvas("chartCostByProduct");
  if (c3) {
    destroyChart("costByProduct");
    charts.costByProduct = new Chart(c3, {
      type: "bar",
      data: { labels: prodLabels, datasets: [{ label: "Custo rateado", data: prodVals, backgroundColor: "rgba(163,199,46,.70)" }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: Chart.defaults.borderColor } },
          y: { grid: { color: Chart.defaults.borderColor } }
        }
      }
    });
  }

  // 4) Custo médio por tipo de serviço
  const byType = new Map();
  for (const s of rows) {
    const cost = sum((s.service_expenses || []).map(e => e.amount));
    const type = s.service_type || "(vazio)";
    const cur = byType.get(type) || { cost: 0, n: 0 };
    cur.cost += cost;
    cur.n += 1;
    byType.set(type, cur);
  }
  const typeLabels = Array.from(byType.keys()).sort((a, b) => (byType.get(b).cost / byType.get(b).n) - (byType.get(a).cost / byType.get(a).n));
  const typeAvg = typeLabels.map(t => (byType.get(t).n ? byType.get(t).cost / byType.get(t).n : 0));

  const c4 = safeCanvas("chartAvgByType");
  if (c4) {
    destroyChart("avgByType");
    charts.avgByType = new Chart(c4, {
      type: "bar",
      data: { labels: typeLabels, datasets: [{ label: "Custo médio", data: typeAvg, backgroundColor: "rgba(19,83,82,.80)" }] },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }

  // 5) Acurácia fora da meta por técnico (Top 10) — só se existir canvas
  const outByTech = new Map();
  for (const s of accRows) {
    if (Math.abs(Number(s.accuracy_pct)) <= 25) continue;
    const tech = s.technician || "A definir";
    outByTech.set(tech, (outByTech.get(tech) || 0) + 1);
  }
  const outTechLabels = Array.from(outByTech.keys()).sort((a, b) => outByTech.get(b) - outByTech.get(a)).slice(0, 10);
  const outTechVals = outTechLabels.map(t => outByTech.get(t));

  const c5 = safeCanvas("chartAccOutTech");
  if (c5) {
    destroyChart("accOutTech");
    charts.accOutTech = new Chart(c5, {
      type: "bar",
      data: { labels: outTechLabels, datasets: [{ label: "Fora da meta", data: outTechVals, backgroundColor: "rgba(255,80,80,.35)" }] },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }

  // 6) Horas de treinamento por mês — só se existir canvas
  const byTrainMonth = new Map();
  for (const s of rows) {
    const m = monthKey(s.service_date);
    const h = Number(s.training_hours) || 0;
    byTrainMonth.set(m, (byTrainMonth.get(m) || 0) + h);
  }
  const trainMonthLabels = Array.from(byTrainMonth.keys()).sort();
  const trainMonthVals = trainMonthLabels.map(m => byTrainMonth.get(m));

  const c6 = safeCanvas("chartTrainMonth");
  if (c6) {
    destroyChart("trainMonth");
    charts.trainMonth = new Chart(c6, {
      type: "bar",
      data: { labels: trainMonthLabels, datasets: [{ label: "Horas", data: trainMonthVals, backgroundColor: "rgba(163,199,46,.70)" }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: Chart.defaults.borderColor } },
          y: { grid: { color: Chart.defaults.borderColor } }
        }
      }
    });
  }

  // ===== Table: Top serviços mais caros =====
  const top = rows
    .map(s => ({
      id: s.id,
      date: s.service_date,
      client: s.client_code,
      rd: extractRdCode(s.opportunity_name),
      farm: s.farm_name,
      service: s.service_type,
      tech: s.technician,
      cost: sum((s.service_expenses || []).map(e => e.amount))
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 15);

  const tbody = $("tbodyTop");
  if (tbody) {
    tbody.innerHTML = top.map(x => `
      <tr>
        <td>${fmtDate(x.date)}</td>
        <td>${x.client || "-"}</td>
        <td>${x.rd || "-"}</td>
        <td>${x.farm || "-"}</td>
        <td>${x.service || "-"}</td>
        <td>${x.tech || "-"}</td>
        <td>${brl(x.cost)}</td>
      </tr>
    `).join("");
  }
}

function exportCsv() {
  const rows = getFiltered();
  const headers = [
    "service_date","client_code","rd","farm_name","city","state","technician","service_type","execution_type",
    "gross_value","tax_value","budget_net","realized","accuracy_pct",
    "training_hours","travel_hours","remote_hours","on_site_days",
    "cost_total"
  ];

  const csv = [
    headers.join(","),
    ...rows.map(s => {
      const cost = sum((s.service_expenses || []).map(e => e.amount));
      const row = {
        service_date: s.service_date ?? "",
        client_code: s.client_code ?? "",
        rd: extractRdCode(s.opportunity_name) ?? "",
        farm_name: s.farm_name ?? "",
        city: s.city ?? "",
        state: s.state ?? "",
        technician: s.technician ?? "",
        service_type: s.service_type ?? "",
        execution_type: s.execution_type ?? "",
        gross_value: s.gross_value ?? "",
        tax_value: s.tax_value ?? "",
        budget_net: s.budget_net ?? "",
        realized: s.realized ?? "",
        accuracy_pct: s.accuracy_pct ?? "",
        training_hours: s.training_hours ?? "",
        travel_hours: s.travel_hours ?? "",
        remote_hours: s.remote_hours ?? "",
        on_site_days: s.on_site_days ?? "",
        cost_total: cost ?? ""
      };
      return headers.map(h => JSON.stringify(row[h] ?? "")).join(",");
    })
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "insights_base.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function bindEvents() {
  ["monthFilter", "techFilter", "typeFilter", "stateFilter"].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener("change", rebuild);
  });

  ["clientCodeFilter", "rdCodeFilter", "ccFilter", "search"].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener("input", rebuild);
  });

  const btnClear = $("btnClear");
  if (btnClear) btnClear.addEventListener("click", () => {
    if ($("monthFilter")) $("monthFilter").value = "";
    if ($("techFilter")) $("techFilter").value = "";
    if ($("typeFilter")) $("typeFilter").value = "";
    if ($("stateFilter")) $("stateFilter").value = "";
    if ($("clientCodeFilter")) $("clientCodeFilter").value = "";
    if ($("rdCodeFilter")) $("rdCodeFilter").value = "";
    if ($("ccFilter")) $("ccFilter").value = "";
    if ($("search")) $("search").value = "";
    rebuild();
  });

  const btnExport = $("btnExport");
  if (btnExport) btnExport.addEventListener("click", exportCsv);

  const logout = $("logout");
  if (logout) logout.addEventListener("click", async () => {
    await sb.auth.signOut();
    window.location.href = "./index.html";
  });
}

window.addEventListener("themechange", () => {
  applyChartTheme();
  rebuild();
});

(async () => {
  await guard();
  bindEvents();
  await loadLookups();
  await loadData();
})();