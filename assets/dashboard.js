// ====== CONFIG SUPABASE ======
const SUPABASE_URL = "https://cqivhdtncczqusivydkp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vORmTkgLIbtGQWbU6reAKQ_FslPufXi";
// =======================================

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const brl = (v) =>
  v == null || Number.isNaN(v)
    ? "-"
    : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "-");

const PRODUCT_OPTIONS = [
  "TGC",
  "BI",
  "Data Delivery",
  "ECO Rastreabilidade",
  "ECO Recria Engorda",
  "ECO Cria",
  "CR1 - TGT",
  "App Leitura de Cocho",
  "App Ronda Sanitaria",
];

let RAW = { services: [], remotes: [] };
let charts = {};
let EDIT_ID = null;
let DELETE_ID = null;

let LOOKUPS = {
  expenseCategories: [],
  farms: [],
  farmById: new Map(),
};

const COLORS = {
  teal: "#135352",
  lime: "#A3C72E",
  gray: "#9D9D9C",
  dark: "#575756",
  white: "#FFFFFF",
};

Chart.defaults.font.family = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
Chart.defaults.plugins.legend.labels.boxWidth = 12;

function applyChartTheme(){
  const theme = document.documentElement.dataset.theme || "dark";
  const isLight = theme === "light";

  Chart.defaults.color = isLight ? "rgba(11,18,32,.80)" : "rgba(234,242,255,.78)";
  Chart.defaults.borderColor = isLight ? "rgba(11,18,32,.10)" : "rgba(255,255,255,.10)";
  Chart.defaults.scale = Chart.defaults.scale || {};
}

applyChartTheme();

function sum(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

function safeLower(x) {
  return (x ?? "").toString().toLowerCase();
}

function extractRdCode(opportunityName) {
  // Ex: "251128 - OP. ASSISTIDA - ..." -> "251128"
  const m = (opportunityName || "").trim().match(/^(\d+)/);
  return m ? m[1] : "";
}

// -----------------------------
// AUTH / BOOT
// -----------------------------
async function guard() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) window.location.href = "./index.html";
  $("who").textContent = `Logado como: ${session.user?.email || "(sem email)"}`;

  const adminLink = document.getElementById("adminLink");
  if (adminLink){
    const { data: isAdmin, error } = await sb.rpc("is_admin");
    if (!error && isAdmin === true) adminLink.style.display = "inline-flex";
  }
}

// -----------------------------
// TABS (modal)
// -----------------------------
function initTabs() {
  const tabBtns = document.querySelectorAll("[data-tab]");
  const panels = document.querySelectorAll("[data-tab-panel]");

  function setTab(name) {
    tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    panels.forEach((p) => (p.style.display = p.dataset.tabPanel === name ? "block" : "none"));
  }

  tabBtns.forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  setTab("service");

  return { setTab };
}

let Tabs = null;

// -----------------------------
// LOOKUPS (expense categories + farms)
// -----------------------------
async function loadLookups() {
  // 1) expense categories
  {
    const { data, error } = await sb
      .from("expense_categories")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) {
      console.warn("Não consegui carregar expense_categories:", error.message);
      LOOKUPS.expenseCategories = [];
    } else {
      LOOKUPS.expenseCategories = data || [];
    }
  }

  // 2) farms
  {
    const { data, error } = await sb
      .from("farms")
      .select("id, protheus_client_code, protheus_farm_code, protheus_cost_center, name, city, state")
      .order("name", { ascending: true });

    if (error) {
      console.warn("Não consegui carregar farms:", error.message);
      LOOKUPS.farms = [];
      LOOKUPS.farmById = new Map();
    } else {
      LOOKUPS.farms = data || [];
      LOOKUPS.farmById = new Map((data || []).map((f) => [f.id, f]));
    }
  }

  renderFarmSelect(); // popula select no modal
}

// -----------------------------
// FARM UI (search/select/use/save)
// -----------------------------
function farmLabel(f) {
  const parts = [
    f.name,
    f.city ? `— ${f.city}` : "",
    f.state ? `/${f.state}` : "",
    f.protheus_client_code ? `— Cliente: ${f.protheus_client_code}` : "",
    f.protheus_cost_center ? `— CC: ${f.protheus_cost_center}` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

function renderFarmSelect(searchTerm = "") {
  const sel = $("farmSelect");
  if (!sel) return;

  const term = safeLower(searchTerm).trim();

  const list = !term
    ? LOOKUPS.farms
    : LOOKUPS.farms.filter((f) => {
        const blob = [
          f.name,
          f.city,
          f.state,
          f.protheus_client_code,
          f.protheus_farm_code,
          f.protheus_cost_center,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return blob.includes(term);
      });

  sel.innerHTML =
    ['<option value="">Selecione…</option>']
      .concat(list.map((f) => `<option value="${f.id}">${farmLabel(f)}</option>`))
      .join("");

  // tenta manter selecionado se possível
  const cur = $("f_farm_id")?.value;
  if (cur && list.some((x) => x.id === cur)) sel.value = cur;
}

function useSelectedFarm() {
  const farmId = $("farmSelect").value;
  if (!farmId) {
    $("farmMsg").textContent = "Selecione uma fazenda primeiro 🙂";
    return;
  }
  const f = LOOKUPS.farmById.get(farmId);
  if (!f) return;

  // seta farm_id escondido
  $("f_farm_id").value = f.id;

  // preenche os campos do serviço (pra ficar visível)
  $("f_farm").value = f.name || "";
  $("f_city").value = f.city || "";
  $("f_state").value = f.state || "";

  // se ainda não tem client_code no serviço, puxa do cadastro
  if (!($("f_client_code").value || "").trim()) {
    $("f_client_code").value = f.protheus_client_code || "";
  }

  $("farmMsg").textContent = "Fazenda vinculada ao serviço ✅";
  if (Tabs) Tabs.setTab("service");
}

async function saveFarm() {
  $("farmMsg").textContent = "Salvando fazenda…";

  const payload = {
    protheus_client_code: ($("new_client_code").value || "").trim() || null,
    protheus_farm_code: ($("new_farm_code").value || "").trim() || null,
    protheus_cost_center: ($("new_cost_center").value || "").trim() || null,
    name: ($("new_farm_name").value || "").trim(),
    city: ($("new_city").value || "").trim() || null,
    state: ($("new_state").value || "").trim() || null,
    // client_id vai como null por enquanto (a gente “amarrará” quando criar a tela de Clientes)
    client_id: null,
  };

  if (!payload.name) {
    $("farmMsg").textContent = "Nome da fazenda é obrigatório.";
    return;
  }

  const { data, error } = await sb
    .from("farms")
    .insert(payload)
    .select("id, protheus_client_code, protheus_farm_code, protheus_cost_center, name, city, state")
    .single();

  if (error) {
    console.error(error);
    $("farmMsg").textContent = "Erro: " + error.message;
    return;
  }

  // atualiza lookup em memória
  LOOKUPS.farms.push(data);
  LOOKUPS.farmById.set(data.id, data);

  // seleciona e usa no serviço
  renderFarmSelect($("farmSearch").value || "");
  $("farmSelect").value = data.id;
  $("farmMsg").textContent = "Fazenda salva ✅ (agora vincule ao serviço)";

  // auto-vincular
  useSelectedFarm();
}

// -----------------------------
// PRODUCTS PICKER
// -----------------------------
function renderProductPicker(existing = []) {
  const map = new Map(existing.map((p) => [p.product, Number(p.quantity) || 0]));
  const box = $("prodRows");
  if (!box) return;

  box.innerHTML = "";

  const makeRowFixed = (name, qty) => {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1fr 120px";
    row.style.gap = "10px";
    row.style.marginBottom = "8px";
    row.style.alignItems = "center";
    row.dataset.custom = "0";

    row.innerHTML = `
      <div class="badge" style="display:flex; align-items:center; padding:10px 12px;">${name}</div>
      <input class="input" type="number" step="1" min="0" placeholder="Qtd" value="${qty ?? ""}" data-role="prodQty" data-prod="${name}">
    `;
    box.appendChild(row);
  };

  const makeRowCustom = (name, qty) => {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1fr 120px 44px";
    row.style.gap = "10px";
    row.style.marginBottom = "8px";
    row.style.alignItems = "center";
    row.dataset.custom = "1";

    row.innerHTML = `
      <input class="input" placeholder="Nome do produto" value="${name || ""}" data-role="prodName">
      <input class="input" type="number" step="1" min="0" placeholder="Qtd" value="${qty ?? ""}" data-role="prodQty">
      <button class="btn" type="button" data-role="remove">✕</button>
    `;
    row.querySelector('[data-role="remove"]').onclick = () => row.remove();
    box.appendChild(row);
  };

  for (const p of PRODUCT_OPTIONS) makeRowFixed(p, map.get(p) || "");

  for (const [prod, qty] of map.entries()) {
    if (!PRODUCT_OPTIONS.includes(prod)) makeRowCustom(prod, qty);
  }
}

function addCustomProductRow() {
  const box = $("prodRows");
  if (!box) return;

  const row = document.createElement("div");
  row.style.display = "grid";
  row.style.gridTemplateColumns = "1fr 120px 44px";
  row.style.gap = "10px";
  row.style.marginBottom = "8px";
  row.dataset.custom = "1";

  row.innerHTML = `
    <input class="input" placeholder="Nome do produto" data-role="prodName">
    <input class="input" type="number" step="1" min="0" placeholder="Qtd" data-role="prodQty">
    <button class="btn" type="button" data-role="remove">✕</button>
  `;
  row.querySelector('[data-role="remove"]').onclick = () => row.remove();
  box.appendChild(row);
}

function collectProductsFromPicker() {
  const out = [];
  const rows = document.querySelectorAll("#prodRows > div");

  rows.forEach((r) => {
    const isCustom = r.dataset.custom === "1";

    if (isCustom) {
      const name = (r.querySelector('[data-role="prodName"]')?.value || "").trim();
      const qty = Number(r.querySelector('[data-role="prodQty"]')?.value || 0);
      if (name && qty > 0) out.push({ product: name, quantity: qty });
      return;
    }

    const inp = r.querySelector('[data-role="prodQty"]');
    const name = inp?.dataset.prod;
    const qty = Number(inp?.value || 0);
    if (name && qty > 0) out.push({ product: name, quantity: qty });
  });

  return out;
}

// -----------------------------
// EXPENSES PICKER
// -----------------------------
function renderExpensePicker(existing = []) {
  const box = $("expRows");
  if (!box) return;

  box.innerHTML = "";

  if (!LOOKUPS.expenseCategories.length) {
    box.innerHTML = `<div class="small">Sem categorias em <b>expense_categories</b>.</div>`;
    return;
  }

  for (const e of existing) addExpenseRow(e);
}

function addExpenseRow(prefill = null) {
  const box = $("expRows");
  if (!box) return;
  if (!LOOKUPS.expenseCategories.length) return;

  const row = document.createElement("div");
  row.style.display = "grid";
  row.style.gridTemplateColumns = "1fr 140px 140px 1fr 1fr 44px";
  row.style.gap = "10px";
  row.style.marginBottom = "8px";

  const catOptions = LOOKUPS.expenseCategories
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join("");

  row.innerHTML = `
    <select class="input" data-role="expCat">${catOptions}</select>
    <input class="input" type="number" step="0.01" min="0" placeholder="Valor" data-role="expAmt">
    <input class="input" type="date" data-role="expDate">
    <input class="input" placeholder="Fornecedor / Local" data-role="expVendor">
    <input class="input" placeholder="Obs" data-role="expNotes">
    <button class="btn" type="button" data-role="remove">✕</button>
  `;

  row.querySelector('[data-role="remove"]').onclick = () => row.remove();

  if (prefill) {
    row.querySelector('[data-role="expCat"]').value = String(prefill.category_id ?? "");
    row.querySelector('[data-role="expAmt"]').value = prefill.amount ?? "";
    row.querySelector('[data-role="expDate"]').value = prefill.expense_date ?? "";
    row.querySelector('[data-role="expVendor"]').value = prefill.vendor ?? "";
    row.querySelector('[data-role="expNotes"]').value = prefill.notes ?? "";
  }

  box.appendChild(row);
}

function collectExpensesFromPicker() {
  const out = [];
  const rows = document.querySelectorAll("#expRows > div");

  rows.forEach((r) => {
    const category_id = Number(r.querySelector('[data-role="expCat"]')?.value || 0);
    const amount = Number(r.querySelector('[data-role="expAmt"]')?.value || 0);
    const expense_date = r.querySelector('[data-role="expDate"]')?.value || null;
    const vendor = r.querySelector('[data-role="expVendor"]')?.value || null;
    const notes = r.querySelector('[data-role="expNotes"]')?.value || null;

    if (category_id && amount > 0) {
      out.push({ category_id, amount, expense_date, vendor, notes });
    }
  });

  return out;
}

// -----------------------------
// DATA LOAD
// -----------------------------
async function loadData() {
  // services + products + expenses
let r = await sb
    .from("services")
    .select(
      "id, status, deleted_at, farm_id, service_date, client_code, opportunity_name, farm_name, city, state, technician, service_type, bu, budget_net, realized, notes, service_products(product, quantity), service_expenses(category_id, amount, expense_date, vendor, notes)"
    )
    .is("deleted_at", null)
    .order("service_date", { ascending: false });

  if (r.error) {
    console.warn("Falhou embed service_expenses; buscando sem:", r.error.message);
    r = await sb
      .from("services")
      .select(
        "id, farm_id, service_date, client_code, opportunity_name, farm_name, city, state, technician, service_type, bu, budget_net, realized, notes, service_products(product, quantity)"
      )
      .order("service_date", { ascending: false });
  }

  if (r.error) {
    console.error(r.error);
    alert("Erro lendo services: " + r.error.message);
    return;
  }

  const { data: remotes, error: e2 } = await sb
    .from("remote_services")
    .select("id, service_date, solution, quantity")
    .order("service_date", { ascending: false });

  if (e2) {
    console.error(e2);
    alert("Erro lendo remote_services: " + e2.message);
    return;
  }

  RAW.services = r.data || [];
  RAW.remotes = remotes || [];

  buildFilters();
  rebuild();
}

// -----------------------------
// FILTERS
// -----------------------------
function buildFilters() {
  const months = Array.from(
    new Set(RAW.services.map((r) => (r.service_date ? r.service_date.slice(0, 7) : "Sem data")))
  ).sort();

  $("monthFilter").innerHTML = ['<option value="">Todos os meses</option>']
    .concat(months.map((m) => `<option value="${m}">${m}</option>`))
    .join("");

  const techs = Array.from(new Set(RAW.services.map((r) => r.technician || "A definir"))).sort();
  $("techFilter").innerHTML = ['<option value="">Todos os técnicos</option>']
    .concat(techs.map((t) => `<option value="${t}">${t}</option>`))
    .join("");

  const types = Array.from(new Set(RAW.services.map((r) => r.service_type || "(vazio)"))).sort();
  $("typeFilter").innerHTML = ['<option value="">Todos os tipos</option>']
    .concat(types.map((t) => `<option value="${t}">${t}</option>`))
    .join("");

  const states = Array.from(new Set(RAW.services.map((r) => r.state || "(vazio)"))).sort();
  $("stateFilter").innerHTML = ['<option value="">Todos os estados</option>']
    .concat(states.map((s) => `<option value="${s}">${s}</option>`))
    .join("");
}

function getFiltered() {
  const m = $("monthFilter").value;
  const t = $("techFilter").value;
  const ty = $("typeFilter").value;
  const st = $("stateFilter").value;

  const clientCode = safeLower($("clientCodeFilter").value).trim();
  const rdCode = safeLower($("rdCodeFilter").value).trim();
  const cc = safeLower($("ccFilter").value).trim();

  const q = safeLower($("search").value).trim();

  return RAW.services.filter((r) => {
    const month = r.service_date ? r.service_date.slice(0, 7) : "Sem data";
    const tech = r.technician || "A definir";
    const type = r.service_type || "(vazio)";
    const state = r.state || "(vazio)";

    if (m && month !== m) return false;
    if (t && tech !== t) return false;
    if (ty && type !== ty) return false;
    if (st && state !== st) return false;

    if (clientCode) {
      if (!safeLower(r.client_code).includes(clientCode)) return false;
    }

    if (rdCode) {
      const rd = safeLower(extractRdCode(r.opportunity_name));
      const opp = safeLower(r.opportunity_name);
      if (!rd.includes(rdCode) && !opp.includes(rdCode)) return false;
    }

    if (cc) {
      // só funciona bem quando serviço tem farm_id vinculado
      const f = r.farm_id ? LOOKUPS.farmById.get(r.farm_id) : null;
      const ccVal = safeLower(f?.protheus_cost_center);
      if (!ccVal.includes(cc)) return false;
    }

    if (!q) return true;

    const blob = [
      r.client_code,
      extractRdCode(r.opportunity_name),
      r.opportunity_name,
      r.farm_name,
      r.city,
      r.state,
      r.technician,
      r.service_type,
      r.bu,
      r.notes,
      // farm extras
      r.farm_id ? LOOKUPS.farmById.get(r.farm_id)?.protheus_cost_center : "",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return blob.includes(q);
  });
}

function classifyServiceType(s) {
  const x = safeLower(s);
  if (x.includes("implant")) return "Implantações";
  if (x.includes("trein")) return "Treinamentos";
  if (x.includes("assist")) return "Operação Assistida";
  return "Outros";
}

// -----------------------------
// RENDER DASH
// -----------------------------
function rebuild() {
  const rows = getFiltered();
  $("rowsBadge").textContent = rows.length;
  $("rowCount").textContent = `${rows.length} linhas (com os filtros atuais)`;

  const budget = sum(rows.map((r) => r.budget_net));
  const realized = sum(rows.map((r) => r.realized));
  const ratio = budget ? realized / budget : null;

  const kpiCounts = { Implantações: 0, Treinamentos: 0, "Operação Assistida": 0 };
  for (const r of rows) {
    const c = classifyServiceType(r.service_type);
    if (c === "Implantações") kpiCounts["Implantações"]++;
    if (c === "Treinamentos") kpiCounts["Treinamentos"]++;
    if (c === "Operação Assistida") kpiCounts["Operação Assistida"]++;
  }

  $("kpiGrid").innerHTML = [
    { label: "Implantações realizadas", value: kpiCounts["Implantações"], foot: "Qtd no filtro atual" },
    { label: "Treinamentos realizados", value: kpiCounts["Treinamentos"], foot: "Qtd no filtro atual" },
    { label: "Operação assistida", value: kpiCounts["Operação Assistida"], foot: "Qtd no filtro atual" },
    { label: "Verba disponível", value: brl(budget), foot: "Soma do orçamento líquido" },
    { label: "Verba utilizada", value: brl(realized), foot: `Realização: ${ratio == null ? "-" : (ratio * 100).toFixed(1) + "%"}` },
  ]
    .map(
      (k) => `
    <div class="kpi">
      <div class="kpiLabel">${k.label}</div>
      <div class="kpiValue">${k.value}</div>
      <div class="kpiFoot">${k.foot}</div>
    </div>
  `
    )
    .join("");

  const byMonth = new Map();
  for (const r of rows) {
    const k = r.service_date ? r.service_date.slice(0, 7) : "Sem data";
    const cur = byMonth.get(k) || { budget: 0, realized: 0, count: 0 };
    cur.budget += Number(r.budget_net) || 0;
    cur.realized += Number(r.realized) || 0;
    cur.count += 1;
    byMonth.set(k, cur);
  }
  const monthLabels = Array.from(byMonth.keys()).sort();
  const monthBudget = monthLabels.map((k) => byMonth.get(k).budget);
  const monthReal = monthLabels.map((k) => byMonth.get(k).realized);
  const monthCount = monthLabels.map((k) => byMonth.get(k).count);

  const byTech = new Map();
  for (const r of rows) {
    const k = r.technician || "A definir";
    byTech.set(k, (byTech.get(k) || 0) + 1);
  }
  const techLabels = Array.from(byTech.keys()).sort((a, b) => byTech.get(b) - byTech.get(a)).slice(0, 12);
  const techCounts = techLabels.map((k) => byTech.get(k));

  const productSet = new Set();
  const techProd = new Map();
  for (const r of rows) {
    const tech = r.technician || "A definir";
    const prods = r.service_products || [];
    const cur = techProd.get(tech) || {};
    for (const p of prods) {
      const prod = p.product || "—";
      productSet.add(prod);
      cur[prod] = (cur[prod] || 0) + (Number(p.quantity) || 0);
    }
    techProd.set(tech, cur);
  }

  const prodLabels = [
    ...PRODUCT_OPTIONS.filter((p) => productSet.has(p)),
    ...Array.from(productSet.values()).filter((p) => !PRODUCT_OPTIONS.includes(p)).sort(),
  ];

  const prodColors = [
    COLORS.lime,
    COLORS.teal,
    COLORS.gray,
    COLORS.dark,
    "rgba(163,199,46,.35)",
    "rgba(19,83,82,.35)",
    "rgba(157,157,156,.35)",
  ];

  const datasetsProducts = prodLabels.map((prod, i) => ({
    label: prod,
    data: techLabels.map((t) => techProd.get(t)?.[prod] || 0),
    backgroundColor: prodColors[i % prodColors.length],
    borderColor: "rgba(255,255,255,.08)",
    borderWidth: 1,
  }));

  const bySol = new Map();
  for (const r of RAW.remotes) {
    const k = r.solution || "—";
    bySol.set(k, (bySol.get(k) || 0) + (Number(r.quantity) || 0));
  }
  const solLabels = Array.from(bySol.keys()).sort((a, b) => bySol.get(b) - bySol.get(a)).slice(0, 10);
  const solVals = solLabels.map((k) => bySol.get(k));

  renderTable(rows);
  renderCharts({ monthLabels, monthBudget, monthReal, monthCount, techLabels, techCounts, datasetsProducts, solLabels, solVals });
}

function renderTable(rows) {
  $("tbody").innerHTML = rows
    .map((r) => {
      const variance = (Number(r.realized) || 0) - (Number(r.budget_net) || 0);
      const rd = extractRdCode(r.opportunity_name);
      return `
      <tr>
        <td>${fmtDate(r.service_date)}</td>
        <td>${r.client_code || "-"}</td>
        <td>${rd || "-"}</td>
        <td>${r.farm_name || "-"}</td>
        <td>${(r.city || "-")} / <span class="pill">${r.state || "-"}</span></td>
        <td>${r.service_type || "-"}</td>
        <td>${r.bu || "-"}</td>
        <td>${brl(r.budget_net)}</td>
        <td>${brl(r.realized)}</td>
        <td>${brl(variance)}</td>
        <td>
          <div class="cmdBar">
            <button class="cmdBtn" title="Detalhar" data-view="${r.id}">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" stroke-width="2"/>
                <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
              </svg>
            </button>

            <button class="cmdBtn" title="Editar" data-edit="${r.id}" ${r.status === "closed" ? "disabled" : ""}>
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 20h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
              </svg>
            </button>

            <button class="cmdBtn danger" title="Excluir" data-del="${r.id}" ${r.status === "closed" ? "disabled" : ""}>
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <path d="M8 6V4h8v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <path d="M6 6l1 16h10l1-16" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => openDetail(btn.dataset.view));
  });

  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openEdit(btn.dataset.edit));
  });

  document.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => requestDelete(btn.dataset.del));
  });
}

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    charts[key] = null;
  }
}

function renderCharts(d) {
  destroyChart("budget");
  charts.budget = new Chart($("chartBudget"), {
    type: "bar",
    data: {
      labels: d.monthLabels,
      datasets: [
        { label: "Orçamento", data: d.monthBudget, backgroundColor: COLORS.lime },
        { label: "Realizado", data: d.monthReal, backgroundColor: COLORS.teal },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "top" } },
      scales: {
        x: { grid: { color: Chart.defaults.borderColor } },
        y: { grid: { color: Chart.defaults.borderColor } },
      },
    },
  });

  destroyChart("tech");
  charts.tech = new Chart($("chartTech"), {
    type: "bar",
    data: {
      labels: d.techLabels,
      datasets: [{ label: "Serviços", data: d.techCounts, backgroundColor: "rgba(163,199,46,.75)" }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: Chart.defaults.borderColor } },
        y: { grid: { color: Chart.defaults.borderColor } },
      },
    },
  });

  destroyChart("products");
  charts.products = new Chart($("chartProducts"), {
    type: "bar",
    data: { labels: d.techLabels, datasets: d.datasetsProducts },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: { stacked: true, grid: { color: Chart.defaults.borderColor } },
        y: { stacked: true, grid: { color: Chart.defaults.borderColor } },
      },
    },
  });

  destroyChart("countMonth");
  charts.countMonth = new Chart($("chartCountMonth"), {
    type: "bar",
    data: {
      labels: d.monthLabels,
      datasets: [{ label: "Serviços", data: d.monthCount, backgroundColor: "rgba(19,83,82,.80)" }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: Chart.defaults.borderColor } },
        y: { grid: { color: Chart.defaults.borderColor } },
      },
    },
  });

  destroyChart("remote");
  charts.remote = new Chart($("chartRemote"), {
    type: "bar",
    data: {
      labels: d.solLabels,
      datasets: [{ label: "Qtd", data: d.solVals, backgroundColor: "rgba(157,157,156,.65)" }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: Chart.defaults.borderColor } },
        y: { grid: { color: Chart.defaults.borderColor } },
      },
    },
  });
}

// -----------------------------
// MODAL (new/edit/save)
// -----------------------------
function resetModalInteractivity() {
  const modal = $("modalBg");
  if (!modal) return;

  // reabilita tudo 
  modal.querySelectorAll("input, select, textarea").forEach((el) => (el.disabled = false));

  const btnSave = $("btnSave");
  if (btnSave) btnSave.style.display = "";

  ["btnAddProd", "btnAddExp", "btnUseFarm", "btnSaveFarm"].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = false;
  });
}

function openModal() {
  $("modalBg").style.display = "grid";
  $("formMsg").textContent = "";
  $("farmMsg").textContent = "";
  if (Tabs) Tabs.setTab("service");
}

function closeModal() {
  $("modalBg").style.display = "none";
  $("btnSave").style.display = ""; //volta botoes /input
  EDIT_ID = null;
}

function clearForm() {
  $("f_farm_id").value = "";
  $("f_date").value = "";
  $("f_tech").value = "";
  $("f_client_code").value = "";
  $("f_opportunity").value = "";
  $("f_farm").value = "";
  $("f_city").value = "";
  $("f_state").value = "";
  $("f_type").value = "";
  $("f_bu").value = "";
  $("f_budget").value = "";
  $("f_real").value = "";
  renderProductPicker([]);
  renderExpensePicker([]);
}

function parsePt(v){
  if(v == null) return null;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function calcNet(gross, taxPct){
  if(gross == null) return null;
  const t = taxPct == null ? 0 : taxPct;
  return gross * (1 - (t/100));
}

function updateBudgetNetUI(){
  const gross = parsePt($("f_gross")?.value);
  const tax = parsePt($("f_tax")?.value);
  const net = calcNet(gross, tax);
  if($("f_budget")) $("f_budget").value = net == null ? "" : net.toFixed(2).replace(".", ",");
}

function openNew() {
  EDIT_ID = null;
  clearForm();
  renderFarmSelect("");
  openModal();
}

function openEdit(id) {
  const svc = RAW.services.find((s) => s.id === id);
  if (!svc) return;
  
  EDIT_ID = id;

  $("f_farm_id").value = svc.farm_id || "";
  $("f_date").value = svc.service_date || "";
  $("f_tech").value = svc.technician || "";
  $("f_client_code").value = svc.client_code || "";
  $("f_opportunity").value = svc.opportunity_name || "";
  $("f_farm").value = svc.farm_name || "";
  $("f_city").value = svc.city || "";
  $("f_state").value = svc.state || "";
  $("f_type").value = svc.service_type || "";
  $("f_bu").value = svc.bu || "";
  $("f_budget").value = svc.budget_net ?? "";
  $("f_real").value = svc.realized ?? "";
  $("f_exec").value = "Presencial";
  $("f_train_hours").value = "";
  $("f_travel_hours").value = "";
  $("f_on_site_days").value = "";
  $("f_remote_hours").value = "";
  $("timePresencialFields").style.display = "";
  $("timeRemotoFields").style.display = "none";
  updateBudgetNetUI();

  renderProductPicker(svc.service_products || []);
  renderExpensePicker(svc.service_expenses || []);

  renderFarmSelect($("farmSearch").value || "");
  restoreEditMode(svc); // garante modo de edição habilitado
  openModal();
}

function setStatusUI(svc) {
  const pill = $("svcStatusPill");
  const msg = $("svcStatusMsg");
  const btnClose = $("btnCloseSvc");
  const btnReopen = $("btnReopenSvc");

  if (!pill) return;

  const hasId = !!EDIT_ID;

  const isClosed = svc.status === "closed";
  pill.textContent = isClosed ? "FECHADO" : "ABERTO";
  pill.classList.toggle("closed", isClosed);
  pill.classList.toggle("open", !isClosed);

  // botões
  btnClose.style.display = isClosed ? "none" : "inline-flex";
  btnReopen.style.display = isClosed ? "inline-flex" : "none";

  btnClose.disabled = !hasId;
  btnReopen.disabled = !hasId;

  msg.textContent = !hasId
    ? "Salve o serviço primeirio para poder fechar/reabrir."
    : (isClosed
        ? "Serviço fechado: não permite editar/excluir. Para reabrir, justifique."
        : "Serviço aberto: permite editar/excluir. Para fechar, justifique.");
}

function openDetail(id) {
  const svc = RAW.services.find((s) => s.id === id);
  if (!svc) return;

  // Reaproveita o modal: só “bloqueia” inputs e esconde salvar
  openEdit(id);

  $("f_exec").value = svc.execution_type || "Presencial";
  $("f_train_hours").value = svc.training_hours ?? "";
  $("f_travel_hours").value = svc.travel_hours ?? "";
  $("f_on_site_days").value = svc.on_site_days ?? "";
  $("f_remote_hours").value = svc.remote_hours ?? "";

  $("f_gross").value = (svc.gross_value ?? "") === "" ? "" : String(svc.gross_value).replace(".", ",");
  $("f_tax").value = (svc.tax_value ?? "") === "" ? "" : String(svc.tax_value).replace(".", ",");

  $("timePresencialFields").style.display = ($("f_exec").value === "Presencial") ? "" : "none";
  $("timeRemotoFields").style.display = ($("f_exec").value === "Remoto") ? "" : "none";

  updateBudgetNetUI();
  
  // bloquear campos (menos botões de status e fechar)
  const modal = $("modalBg");
  modal.querySelectorAll("input, select, textarea").forEach((el) => {
    const keepEnabled = ["svcStatusReason"].includes(el.id);
    el.disabled = !keepEnabled;
  });

  $("btnSave").style.display = "none";
  $("btnAddProd").disabled = true;
  $("btnAddExp").disabled = true;
  $("btnUseFarm").disabled = true;
  $("btnSaveFarm").disabled = true;

  $("formMsg").textContent = "Modo consulta (Detalhar).";
  setStatusUI(svc);
}

function restoreEditMode(svc) {
  const modal = $("modalBg");
  modal.querySelectorAll("input, select, textarea").forEach((el) => (el.disabled = false));
  $("btnSave").style.display = "";
  $("btnAddProd").disabled = false;
  $("btnAddExp").disabled = false;
  $("btnUseFarm").disabled = false;
  $("btnSaveFarm").disabled = false;
  setStatusUI(svc);
}

async function requestDelete(id) {
  const svc = RAW.services.find((s) => s.id === id);
  if (!svc) return;

  if (svc.status === "closed") {
    alert("Serviço FECHADO não pode ser excluído. Reabra com justificativa primeiro.");
    return;
  }

  DELETE_ID = id;

  // resumo no modal
  const rd = extractRdCode(svc.opportunity_name);
  const summary = `${svc.farm_name || "-"} • ${svc.client_code || "-"} • RD ${rd || "-"} • ${svc.service_type || "-"}`;
  $("delSummary").textContent = summary;

  $("delReason").value = "";
  $("delMsg").textContent = "";

  $("delBg").style.display = "grid";
}

async function confirmDelete() {
  const reason = ($("delReason").value || "").trim();
  if (reason.length < 3) {
    $("delMsg").textContent = "Justificativa obrigatória (mínimo 3 caracteres).";
    return;
  }
  if (!DELETE_ID) return;

  $("delMsg").textContent = "Excluindo…";

  const { error } = await sb.rpc("soft_delete_service", {
    p_service_id: DELETE_ID,
    p_reason: reason,
  });

  if (error) {
    console.error(error);
    $("delMsg").textContent = "Erro: " + error.message;
    return;
  }

  $("delBg").style.display = "none";
  DELETE_ID = null;

  await loadData();
}

function closeDeleteModal() {
  $("delBg").style.display = "none";
  DELETE_ID = null;
}

async function closeCurrentService() {
  if (!EDIT_ID) return;

  const svc = RAW.services.find((s) => s.id === EDIT_ID);
  if (!svc) return;

  if (svc.status === "closed") return;

  const reason = ($("svcStatusReason").value || "").trim();
  if (reason.length < 3) {
    $("svcStatusMsg").textContent = "Justificativa obrigatória (mínimo 3 caracteres).";
    return;
  }

  const { error } = await sb.rpc("close_service", { p_service_id: EDIT_ID, p_reason: reason });
  if (error) {
    console.error(error);
    $("svcStatusMsg").textContent = "Erro ao fechar: " + error.message;
    return;
  }

  $("svcStatusReason").value = "";
  await loadData();
  openEdit(EDIT_ID); // recarrega modal
}

async function reopenCurrentService() {
  if (!EDIT_ID) return;

  const svc = RAW.services.find((s) => s.id === EDIT_ID);
  if (!svc) return;

  if (svc.status !== "closed") return;

  const reason = ($("svcStatusReason").value || "").trim();
  if (reason.length < 3) {
    $("svcStatusMsg").textContent = "Justificativa obrigatória (mínimo 3 caracteres).";
    return;
  }

  const { error } = await sb.rpc("reopen_service", { p_service_id: EDIT_ID, p_reason: reason });
  if (error) {
    console.error(error);
    $("svcStatusMsg").textContent = "Erro ao reabrir: " + error.message;
    return;
  }

  $("svcStatusReason").value = "";
  await loadData();
  openEdit(EDIT_ID); // recarrega modal
}

async function saveService() {
  $("formMsg").textContent = "Salvando…";

  const payload = {
    farm_id: ($("f_farm_id").value || "").trim() || null,
    service_date: $("f_date").value || null,
    technician: ($("f_tech").value || "").trim() || null,
    client_code: ($("f_client_code").value || "").trim() || null,
    opportunity_name: ($("f_opportunity").value || "").trim() || null,
    farm_name: ($("f_farm").value || "").trim() || null,
    city: ($("f_city").value || "").trim() || null,
    state: ($("f_state").value || "").trim() || null,
    service_type: ($("f_type").value || "").trim() || null,
    bu: ($("f_bu").value || "").trim() || null,
    execution_type: $("f_exec").value || null,
    training_hours: parsePt($("f_train_hours").value),
    travel_hours: parsePt($("f_travel_hours").value),
    on_site_days: parsePt($("f_on_site_days").value),
    remote_hours: parsePt($("f_remote_hours").value),
    gross_value: parsePt($("f_gross").value),
    tax_value: parsePt($("f_tax").value),
    realized: parsePt($("f_real").value)
  };

  let serviceId = EDIT_ID;

  if (!EDIT_ID) {
    const { data, error } = await sb.from("services").insert(payload).select("id").single();
    if (error) {
      console.error(error);
      $("formMsg").textContent = "Erro: " + error.message;
      return;
    }
    serviceId = data.id;
  } else {
    const { error } = await sb.from("services").update(payload).eq("id", EDIT_ID);
    if (error) {
      console.error(error);
      $("formMsg").textContent = "Erro: " + error.message;
      return;
    }
  }

  // PRODUTOS: delete + insert
  {
    const prods = collectProductsFromPicker();
    const { error: delErr } = await sb.from("service_products").delete().eq("service_id", serviceId);
    if (delErr) {
      console.error(delErr);
      $("formMsg").textContent = "Erro limpando produtos: " + delErr.message;
      return;
    }
    if (prods.length) {
      const rows = prods.map((p) => ({ service_id: serviceId, ...p }));
      const { error: insErr } = await sb.from("service_products").insert(rows);
      if (insErr) {
        console.error(insErr);
        $("formMsg").textContent = "Erro salvando produtos: " + insErr.message;
        return;
      }
    }
  }

  // DESPESAS: delete + insert
  {
    const exps = collectExpensesFromPicker();
    const { error: delErr } = await sb.from("service_expenses").delete().eq("service_id", serviceId);
    if (delErr) {
      console.error(delErr);
      $("formMsg").textContent = "Erro limpando despesas: " + delErr.message;
      return;
    }
    if (exps.length) {
      const rows = exps.map((e) => ({ service_id: serviceId, ...e }));
      const { error: insErr } = await sb.from("service_expenses").insert(rows);
      if (insErr) {
        console.error(insErr);
        $("formMsg").textContent = "Erro salvando despesas: " + insErr.message;
        return;
      }
    }
  }

  closeModal();
  await loadLookups(); // atualiza farms/categorias
  await loadData();
}

// -----------------------------
// EXPORT
// -----------------------------
function exportCsv() {
  const rows = getFiltered();
  const headers = [
    "service_date",
    "client_code",
    "rd_code",
    "farm_name",
    "city",
    "state",
    "technician",
    "service_type",
    "bu",
    "budget_net",
    "realized",
    "cost_center",
  ];

  const csv = [
    headers.join(","),
    ...rows.map((r) => {
      const rd = extractRdCode(r.opportunity_name);
      const cc = r.farm_id ? LOOKUPS.farmById.get(r.farm_id)?.protheus_cost_center : "";
      const obj = {
        service_date: r.service_date ?? "",
        client_code: r.client_code ?? "",
        rd_code: rd ?? "",
        farm_name: r.farm_name ?? "",
        city: r.city ?? "",
        state: r.state ?? "",
        technician: r.technician ?? "",
        service_type: r.service_type ?? "",
        bu: r.bu ?? "",
        budget_net: r.budget_net ?? "",
        realized: r.realized ?? "",
        cost_center: cc ?? "",
      };
      return headers.map((h) => JSON.stringify(obj[h] ?? "")).join(",");
    }),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "services_export.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// -----------------------------
// EVENTS
// -----------------------------
function bindEvents() {
  // filtros
  $("monthFilter").addEventListener("change", rebuild);
  $("techFilter").addEventListener("change", rebuild);
  $("typeFilter").addEventListener("change", rebuild);
  $("stateFilter").addEventListener("change", rebuild);
  $("search").addEventListener("input", rebuild);

  $("clientCodeFilter").addEventListener("input", rebuild);
  $("rdCodeFilter").addEventListener("input", rebuild);
  $("ccFilter").addEventListener("input", rebuild);

  $("btnClear").addEventListener("click", () => {
    $("monthFilter").value = "";
    $("techFilter").value = "";
    $("typeFilter").value = "";
    $("stateFilter").value = "";
    $("clientCodeFilter").value = "";
    $("rdCodeFilter").value = "";
    $("ccFilter").value = "";
    $("search").value = "";
    rebuild();
  });

  $("btnExport").addEventListener("click", exportCsv);

  // modal
  $("btnNew").addEventListener("click", openNew);
  $("btnClose").addEventListener("click", closeModal);
  $("modalBg").addEventListener("click", (e) => {
    if (e.target.id === "modalBg") closeModal();
  });
  $("btnSave").addEventListener("click", saveService);

  $("f_gross")?.addEventListener("input", updateBudgetNetUI);
  $("f_tax")?.addEventListener("input", updateBudgetNetUI);

  $("f_exec")?.addEventListener("change", () => {
    const v = $("f_exec").value;
    $("timePresencialFields").style.display = (v === "Presencial") ? "" : "none";
    $("timeRemotoFields").style.display = (v === "Remoto") ? "" : "none";
  });

  // status open/close
  $("btnCloseSvc").addEventListener("click", closeCurrentService);
  $("btnReopenSvc").addEventListener("click", reopenCurrentService);

  // products
  $("btnAddProd").addEventListener("click", addCustomProductRow);

  // expenses
  $("btnAddExp").addEventListener("click", () => addExpenseRow());

  // farms
  $("farmSearch").addEventListener("input", (e) => renderFarmSelect(e.target.value));
  $("btnUseFarm").addEventListener("click", useSelectedFarm);
  $("btnSaveFarm").addEventListener("click", saveFarm);

    // delete modal
  $("btnDelClose").addEventListener("click", closeDeleteModal);
  $("btnDelCancel").addEventListener("click", closeDeleteModal);
  $("btnDelConfirm").addEventListener("click", confirmDelete);
  $("delBg").addEventListener("click", (e) => {
    if (e.target.id === "delBg") closeDeleteModal();
  });

  // logout
  $("logout").addEventListener("click", async () => {
    await sb.auth.signOut();
    window.location.href = "./index.html";
  });
}

// -----------------------------
// START
// -----------------------------
window.addEventListener("themechange", () => {
  applyChartTheme();
  rebuild(); // recria gráficos com novas cores
});

(async () => {
  await guard();
  Tabs = initTabs();
  bindEvents();
  await loadLookups();
  await loadData();
})();