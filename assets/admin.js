// ====== CONFIG SUPABASE ======
const SUPABASE_URL = "https://cqivhdtncczqusivydkp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vORmTkgLIbtGQWbU6reAKQ_FslPufXi";
// =======================================

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const safeLower = (x) => (x ?? "").toString().toLowerCase();

let USERS = [];
let USER_ROLES = new Map(); // user_id -> Set(roleName)

async function guard() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) window.location.href = "./index.html";
  $("who").textContent = `Logado como: ${session.user?.email || "(sem email)"}`;
}

async function mustBeAdmin() {
  const { data, error } = await sb.rpc("is_admin");
  if (error) {
    $("msg").textContent = "Erro verificando admin: " + error.message;
    return false;
  }
  if (data !== true) {
    $("msg").textContent = "Acesso restrito: você não é admin.";
    $("tbodyUsers").innerHTML = "";
    return false;
  }
  return true;
}

async function loadUsers() {
  $("msg").textContent = "Carregando usuários…";

  // 1) Carrega lista de usuários (view)
  const u = await sb.from("v_user_roles").select("user_id, full_name, email, roles").order("email", { ascending: true });
  if (u.error) {
    $("msg").textContent = "Erro carregando v_user_roles: " + u.error.message;
    return;
  }
  USERS = u.data || [];

  // 2) Carrega roles por usuário (pra checkboxes)
  const ur = await sb
    .from("user_roles")
    .select("user_id, roles(name)")
    .order("user_id", { ascending: true });

  USER_ROLES = new Map();
  if (!ur.error && ur.data) {
    for (const row of ur.data) {
      const roleName = row.roles?.name;
      if (!roleName) continue;
      const set = USER_ROLES.get(row.user_id) || new Set();
      set.add(roleName);
      USER_ROLES.set(row.user_id, set);
    }
  }

  $("rowsBadge").textContent = USERS.length;
  $("msg").textContent = "";
  render();
}

function roleChecked(userId, role) {
  return USER_ROLES.get(userId)?.has(role) ? "checked" : "";
}

function render() {
  const q = safeLower($("search").value).trim();

  const filtered = !q ? USERS : USERS.filter(u => {
    const blob = [u.email, u.full_name, u.roles].filter(Boolean).join(" ").toLowerCase();
    return blob.includes(q);
  });

  $("rowsBadge").textContent = filtered.length;

  const roleCols = ["viewer", "tech", "finance", "admin"]; // ordem fixa

  $("tbodyUsers").innerHTML = filtered.map(u => {
    const current = u.roles || "";
    return `
      <tr>
        <td>${u.email || "-"}</td>
        <td>${u.full_name || "-"}</td>
        <td>${current || "-"}</td>
        <td>
          <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;">
            ${roleCols.map(r => `
              <label style="display:flex; gap:8px; align-items:center; cursor:pointer;">
                <input type="checkbox" data-user="${u.user_id}" data-role="${r}" ${roleChecked(u.user_id, r)} />
                <span class="badge">${r}</span>
              </label>
            `).join("")}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  document.querySelectorAll('input[type="checkbox"][data-user]').forEach(chk => {
    chk.addEventListener("change", onToggleRole);
  });
}

async function onToggleRole(e) {
  const userId = e.target.dataset.user;
  const role = e.target.dataset.role;
  const enabled = !!e.target.checked;

  $("msg").textContent = `Salvando ${role} para ${userId.slice(0,8)}…`;

  const { error } = await sb.rpc("set_user_role", {
    p_user_id: userId,
    p_role: role,
    p_enabled: enabled
  });

  if (error) {
    console.error(error);
    $("msg").textContent = "Erro: " + error.message;
    // reverte checkbox
    e.target.checked = !enabled;
    return;
  }

  // atualiza cache local
  const set = USER_ROLES.get(userId) || new Set();
  if (enabled) set.add(role);
  else set.delete(role);
  USER_ROLES.set(userId, set);

  // atualiza coluna roles "atual"
  await loadUsers();
}

function bindEvents() {
  $("search").addEventListener("input", render);
  $("btnReload").addEventListener("click", loadUsers);

  $("logout").addEventListener("click", async () => {
    await sb.auth.signOut();
    window.location.href = "./index.html";
  });
}

(async () => {
  await guard();
  bindEvents();
  const ok = await mustBeAdmin();
  if (!ok) return;
  await loadUsers();
})();