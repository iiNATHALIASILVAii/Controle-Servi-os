// ====== CONFIG ======
const SUPABASE_URL = "https://cqivhdtncczqusivydkp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vORmTkgLIbtGQWbU6reAKQ_FslPufXi";
// =======================================

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const brl = (v) => (v == null || Number.isNaN(v)) ? "-" : Number(v).toLocaleString("pt-BR",{ style:"currency", currency:"BRL" });
const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "-";
const safeLower = (x) => (x ?? "").toString().toLowerCase();

Chart.defaults.color = "rgba(234,242,255,.78)";
Chart.defaults.font.family = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
Chart.defaults.plugins.legend.labels.boxWidth = 12;

const COLORS = {
  teal: "#135352",
  lime: "#A3C72E",
  gray: "#9D9D9C",
  dark: "#575756",
};

let RAW = { services: [], farmsById: new Map(), categoriesById: new Map() };
let charts = {};

function extractRdCode(opportunityName) {
  const m = (opportunityName || "").trim().match(/^(\d+)/);
  return m ? m[1] : "";
}
function monthKey(dateStr){
  return dateStr ? dateStr.slice(0,7) : "Sem data";
}
function sum(arr){ return arr.reduce((a,b)=>a+(Number(b)||0), 0); }

async function guard(){
  const { data:{ session } } = await sb.auth.getSession();
  if(!session) window.location.href = "./index.html";
  $("who").textContent = `Logado como: ${session.user?.email || "(sem email)"}`;
}

async function loadLookups(){
  // expense categories
  const cat = await sb.from("expense_categories").select("id,name").order("name",{ascending:true});
  if(cat.error) console.warn(cat.error.message);
  (cat.data || []).forEach(c => RAW.categoriesById.set(c.id, c.name));

  // farms (pra centro de custo)
  const farms = await sb.from("farms").select("id,protheus_cost_center").order("name",{ascending:true});
  if(farms.error) console.warn(farms.error.message);
  (farms.data || []).forEach(f => RAW.farmsById.set(f.id, f));
}

async function loadData(){
  const r = await sb
    .from("services")
    .select("id,status,deleted_at,farm_id,service_date,client_code,opportunity_name,farm_name,city,state,technician,service_type,bu,budget_net,realized,notes,service_products(product,quantity),service_expenses(category_id,amount,expense_date)")
    .is("deleted_at", null)
    .order("service_date",{ascending:false});

  if(r.error){ alert("Erro lendo services: "+r.error.message); return; }

  RAW.services = r.data || [];

  buildFilters();
  rebuild();
}

function buildFilters(){
  const months = Array.from(new Set(RAW.services.map(s => monthKey(s.service_date)))).sort();
  $("monthFilter").innerHTML = ['<option value="">Todos os meses</option>']
    .concat(months.map(m=>`<option value="${m}">${m}</option>`)).join("");

  const techs = Array.from(new Set(RAW.services.map(s => s.technician || "A definir"))).sort();
  $("techFilter").innerHTML = ['<option value="">Todos os técnicos</option>']
    .concat(techs.map(t=>`<option value="${t}">${t}</option>`)).join("");

  const types = Array.from(new Set(RAW.services.map(s => s.service_type || "(vazio)"))).sort();
  $("typeFilter").innerHTML = ['<option value="">Todos os tipos</option>']
    .concat(types.map(t=>`<option value="${t}">${t}</option>`)).join("");

  const states = Array.from(new Set(RAW.services.map(s => s.state || "(vazio)"))).sort();
  $("stateFilter").innerHTML = ['<option value="">Todos os estados</option>']
    .concat(states.map(s=>`<option value="${s}">${s}</option>`)).join("");
}

function getFiltered(){
  const m = $("monthFilter").value;
  const t = $("techFilter").value;
  const ty = $("typeFilter").value;
  const st = $("stateFilter").value;

  const clientCode = safeLower($("clientCodeFilter").value).trim();
  const rdCode = safeLower($("rdCodeFilter").value).trim();
  const cc = safeLower($("ccFilter").value).trim();
  const q = safeLower($("search").value).trim();

  return RAW.services.filter(s => {
    if(m && monthKey(s.service_date) !== m) return false;
    if(t && (s.technician || "A definir") !== t) return false;
    if(ty && (s.service_type || "(vazio)") !== ty) return false;
    if(st && (s.state || "(vazio)") !== st) return false;

    if(clientCode && !safeLower(s.client_code).includes(clientCode)) return false;

    if(rdCode){
      const rd = safeLower(extractRdCode(s.opportunity_name));
      const opp = safeLower(s.opportunity_name);
      if(!rd.includes(rdCode) && !opp.includes(rdCode)) return false;
    }

    if(cc){
      const f = s.farm_id ? RAW.farmsById.get(s.farm_id) : null;
      const ccVal = safeLower(f?.protheus_cost_center);
      if(!ccVal.includes(cc)) return false;
    }

    if(!q) return true;

    const blob = [
      s.client_code, s.opportunity_name, s.farm_name, s.city, s.state,
      s.technician, s.service_type, s.bu, s.notes
    ].filter(Boolean).join(" ").toLowerCase();

    return blob.includes(q);
  });
}

function destroyChart(key){
  if(charts[key]){ charts[key].destroy(); charts[key]=null; }
}

function rebuild(){
  const rows = getFiltered();
  $("rowsBadge").textContent = rows.length;
  $("rowCount").textContent = `${rows.length} serviços no filtro`;

  // custo total real = soma service_expenses.amount
  const totalCost = sum(rows.flatMap(s => (s.service_expenses || []).map(e => e.amount)));
  const totalBudget = sum(rows.map(s => s.budget_net));
  const totalRealizedField = sum(rows.map(s => s.realized)); // pode existir, mas custo real aqui vem de despesas

  // KPI grid (simples)
  $("kpiGrid").innerHTML = [
    {label:"Custo total (despesas)", value: brl(totalCost), foot:"Soma de service_expenses.amount"},
    {label:"Orçamento total", value: brl(totalBudget), foot:"Soma do budget_net"},
    {label:"Diferença (custo - orçamento)", value: brl(totalCost - totalBudget), foot:"(despesas) - orçamento"},
    {label:"Qtd serviços", value: rows.length, foot:"No filtro atual"},
    {label:"Realizado (campo)", value: brl(totalRealizedField), foot:"Soma do campo realized (se usado)"},
  ].map(k=>`
    <div class="kpi">
      <div class="kpiLabel">${k.label}</div>
      <div class="kpiValue">${k.value}</div>
      <div class="kpiFoot">${k.foot}</div>
    </div>
  `).join("");

  // 1) Gastos por categoria
  const byCat = new Map(); // name -> total
  for(const s of rows){
    for(const e of (s.service_expenses || [])){
      const name = RAW.categoriesById.get(e.category_id) || `Categoria ${e.category_id}`;
      byCat.set(name, (byCat.get(name)||0) + (Number(e.amount)||0));
    }
  }
  const catLabels = Array.from(byCat.keys()).sort((a,b)=>byCat.get(b)-byCat.get(a));
  const catVals = catLabels.map(k=>byCat.get(k));

  destroyChart("expByCat");
  charts.expByCat = new Chart($("chartExpByCat"), {
    type:"doughnut",
    data:{ labels:catLabels, datasets:[{ label:"Gastos", data:catVals }] },
    options:{ responsive:true, plugins:{ legend:{ position:"bottom" } } }
  });

  // 2) Gastos por categoria por mês (stack)
  const monthSet = new Set(rows.map(s => monthKey(s.service_date)));
  const months = Array.from(monthSet).sort();
  const catSet = new Set(catLabels); // usa os mesmos
  const catOrder = Array.from(catSet);

  // matriz cat->month->sum
  const mtx = new Map(catOrder.map(c => [c, new Map(months.map(m => [m,0]))]));
  for(const s of rows){
    const m = monthKey(s.service_date);
    for(const e of (s.service_expenses || [])){
      const c = RAW.categoriesById.get(e.category_id) || `Categoria ${e.category_id}`;
      if(!mtx.has(c)) mtx.set(c, new Map(months.map(mm=>[mm,0])));
      mtx.get(c).set(m, (mtx.get(c).get(m)||0) + (Number(e.amount)||0));
    }
  }

  const colorPool = [COLORS.lime, COLORS.teal, COLORS.gray, COLORS.dark, "rgba(163,199,46,.35)", "rgba(19,83,82,.35)"];
  const dsCatMonth = catOrder.map((c, i)=>({
    label: c,
    data: months.map(m=>mtx.get(c)?.get(m)||0),
    backgroundColor: colorPool[i % colorPool.length],
    borderColor: "rgba(255,255,255,.08)",
    borderWidth: 1
  }));

  destroyChart("expCatMonth");
  charts.expCatMonth = new Chart($("chartExpCatMonth"), {
    type:"bar",
    data:{ labels: months, datasets: dsCatMonth },
    options:{
      responsive:true,
      plugins:{ legend:{ position:"bottom" } },
      scales:{ x:{ stacked:true }, y:{ stacked:true } }
    }
  });

  // 3) Custo por produto (rateio proporcional à quantidade)
  // regra: custo do serviço = soma das despesas; rateio = quantity/total_quantity
  const byProdCost = new Map(); // product -> total cost
  const byProdCount = new Map(); // product -> total qty (pra contexto)

  for(const s of rows){
    const serviceCost = sum((s.service_expenses || []).map(e=>e.amount));
    if(serviceCost <= 0) continue;

    const prods = (s.service_products || []).map(p => ({
      product: p.product || "—",
      qty: Number(p.quantity) || 0
    })).filter(x => x.qty > 0);

    const totalQty = sum(prods.map(x=>x.qty));

    if(totalQty <= 0){
      // sem produtos: joga em bucket “Sem produto”
      byProdCost.set("Sem produto", (byProdCost.get("Sem produto")||0) + serviceCost);
      continue;
    }

    for(const p of prods){
      const w = p.qty / totalQty;
      const alloc = serviceCost * w;
      byProdCost.set(p.product, (byProdCost.get(p.product)||0) + alloc);
      byProdCount.set(p.product, (byProdCount.get(p.product)||0) + p.qty);
    }
  }

  const prodLabels = Array.from(byProdCost.keys()).sort((a,b)=>byProdCost.get(b)-byProdCost.get(a)).slice(0, 12);
  const prodVals = prodLabels.map(p=>byProdCost.get(p));

  destroyChart("costByProduct");
  charts.costByProduct = new Chart($("chartCostByProduct"), {
    type:"bar",
    data:{ labels: prodLabels, datasets:[{ label:"Custo rateado", data: prodVals, backgroundColor: "rgba(163,199,46,.70)" }] },
    options:{
      responsive:true,
      plugins:{ legend:{ display:false } },
      scales:{ x:{ grid:{ color:"rgba(255,255,255,.06)" } }, y:{ grid:{ color:"rgba(255,255,255,.06)" } } }
    }
  });

  // 4) Custo médio por tipo de serviço
  const byType = new Map(); // type -> {cost,sumcount}
  for(const s of rows){
    const cost = sum((s.service_expenses || []).map(e=>e.amount));
    const type = s.service_type || "(vazio)";
    const cur = byType.get(type) || { cost:0, n:0 };
    cur.cost += cost;
    cur.n += 1;
    byType.set(type, cur);
  }

  const typeLabels = Array.from(byType.keys()).sort((a,b)=>byType.get(b).cost/byType.get(b).n - byType.get(a).cost/byType.get(a).n);
  const typeAvg = typeLabels.map(t => (byType.get(t).n ? byType.get(t).cost / byType.get(t).n : 0));

  destroyChart("avgByType");
  charts.avgByType = new Chart($("chartAvgByType"), {
    type:"bar",
    data:{ labels:typeLabels, datasets:[{ label:"Custo médio", data:typeAvg, backgroundColor:"rgba(19,83,82,.80)" }] },
    options:{ responsive:true, plugins:{ legend:{ display:false } } }
  });

  // Tabela top serviços mais caros
  const top = rows
    .map(s => ({
      id: s.id,
      date: s.service_date,
      client: s.client_code,
      rd: extractRdCode(s.opportunity_name),
      farm: s.farm_name,
      service: s.service_type,
      tech: s.technician,
      cost: sum((s.service_expenses || []).map(e=>e.amount))
    }))
    .sort((a,b)=>b.cost-a.cost)
    .slice(0, 15);

  $("tbodyTop").innerHTML = top.map(x=>`
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

function exportCsv(){
  const rows = getFiltered();
  const headers = ["service_date","client_code","rd","farm_name","city","state","technician","service_type","bu","budget_net","cost_total"];
  const csv = [
    headers.join(","),
    ...rows.map(s=>{
      const cost = sum((s.service_expenses||[]).map(e=>e.amount));
      const row = {
        service_date: s.service_date ?? "",
        client_code: s.client_code ?? "",
        rd: extractRdCode(s.opportunity_name) ?? "",
        farm_name: s.farm_name ?? "",
        city: s.city ?? "",
        state: s.state ?? "",
        technician: s.technician ?? "",
        service_type: s.service_type ?? "",
        bu: s.bu ?? "",
        budget_net: s.budget_net ?? "",
        cost_total: cost ?? ""
      };
      return headers.map(h=>JSON.stringify(row[h] ?? "")).join(",");
    })
  ].join("\n");

  const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "insights_base.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function bindEvents(){
  ["monthFilter","techFilter","typeFilter","stateFilter"].forEach(id => $(id).addEventListener("change", rebuild));
  ["clientCodeFilter","rdCodeFilter","ccFilter","search"].forEach(id => $(id).addEventListener("input", rebuild));

  $("btnClear").addEventListener("click", ()=>{
    $("monthFilter").value="";
    $("techFilter").value="";
    $("typeFilter").value="";
    $("stateFilter").value="";
    $("clientCodeFilter").value="";
    $("rdCodeFilter").value="";
    $("ccFilter").value="";
    $("search").value="";
    rebuild();
  });

  $("btnExport").addEventListener("click", exportCsv);

  $("logout").addEventListener("click", async ()=>{
    await sb.auth.signOut();
    window.location.href = "./index.html";
  });
}

(async ()=>{
  await guard();
  bindEvents();
  await loadLookups();
  await loadData();
})();