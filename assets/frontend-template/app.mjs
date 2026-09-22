// 减脂工作台前端逻辑：消费 FatLossPack 1.0.0，渲染四区（今日/本周/复盘/我的），
// 支持记录四餐、主动配平、体重趋势图、导入导出。纯原生无框架。

import { createFatLossHostAdapter } from "./host-adapter.mjs";

const METHOD_NAMES = {
  lifestyle: "生活化减脂",
  "carb-cycle": "年前碳水循环",
  recomposition: "增肌减脂并行",
};
const MEAL_NAMES = ["早餐", "午餐", "晚餐", "加餐"];

const state = {
  pack: null,
  revision: null,
  mode: "read",
  tab: "today",
  endpoint: null,
  saving: false,
  foodDb: [],        // 内置食材库（fooddb.json）
  customFoods: [],   // 自定义食材，持久化到 foodLibrary.custom[]
};

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

const SHAPES = {
  leaf: '<path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75C7 8 17 8 17 8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:100%;height:100%;display:block">${SHAPES[name] || ""}</svg>`;
}

// 填充静态 HTML 里的 <i data-shape="..."> 图标（Logo / 顶栏按钮 / 导航）。
// 动态渲染的卡片图标走 icon() 内联，不经过这里。
function hydrateIcons() {
  document.querySelectorAll("i[data-shape]").forEach((node) => {
    node.innerHTML = icon(node.dataset.shape);
  });
}

function el(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

function toast(message, isError = false) {
  const node = $("#toast");
  node.textContent = message;
  node.className = "toast show" + (isError ? " error" : "");
  clearTimeout(node._timer);
  node._timer = setTimeout(() => { node.className = "toast"; }, 2400);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function cloudFetch(resource, options = {}) {
  const hostAdapter = window.FATLOSS_HOST_ADAPTER || null;
  if (!hostAdapter) {
    if (!state.endpoint) throw Object.assign(new Error("未配置数据端点"), { code: "no_endpoint" });
    const url = String(resource).startsWith("http") ? resource : state.endpoint + resource;
    return fetch(url, options);
  }
  const adapter = createFatLossHostAdapter(hostAdapter);
  const method = String(options.method || "GET").toUpperCase();
  try {
    if (method === "PUT") {
      const payload = await adapter.save({
        document: JSON.parse(options.body),
        expectedVersion: state.revision,
      });
      return jsonResponse({ ...payload, revision: payload.revision ?? payload.version });
    }
    const payload = await adapter.load();
    const normalized = payload?.document ? payload : { document: payload };
    return jsonResponse({ ...normalized, revision: normalized.revision ?? normalized.version });
  } catch (error) {
    const code = error?.code || "host_adapter_error";
    return jsonResponse({ error: code, message: error?.message || "宿主云服务调用失败" }, code === "revision_conflict" ? 412 : 500);
  }
}

function detectMode() {
  if (window.FATLOSS_HOST_ADAPTER) return window.FATLOSS_HOST_ADAPTER.mode === "read" ? "read" : "edit";
  const path = window.location.pathname;
  if (/^\/r\//.test(path)) return "read";
  if (/^\/e\//.test(path)) return "edit";
  return "edit";
}

function buildEndpoint() {
  if (window.FATLOSS_HOST_ADAPTER) return null;
  const match = window.location.pathname.match(/^\/([er])\/([^/]+)/);
  if (match) return `/api/${match[1]}/${match[2]}`;
  return "/api/e/demo";
}

async function loadPack() {
  const response = await cloudFetch("/", { method: "GET" });
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error || "加载失败"), { code: payload.error });
  state.pack = payload.document;
  state.revision = payload.revision ?? payload.version;
  return state.pack;
}

// ==========================================================================
// 食材库：内置 fooddb.json + 自定义食材合并，宏量按克数折算
// ==========================================================================
const round1 = (n) => Math.round(n * 10) / 10;
const fmtNum = (n) => String(round1(n || 0));

async function loadFoodDb() {
  try {
    const res = await fetch("/fooddb.json");
    if (res.ok) state.foodDb = (await res.json()).items || [];
  } catch (e) {
    state.foodDb = [];
  }
  state.customFoods = (state.pack?.foodLibrary?.custom) || [];
}

function allFoods() {
  return [...state.foodDb, ...state.customFoods];
}

// 配餐口径名 → 录入库 id 的别名映射（周餐单同步到今日时按名匹配）
const FOOD_ALIASES = {
  "燕麦": "oats", "麦片": "oats",
  "全蛋": "egg", "鸡蛋": "egg",
  "大米（生）": "rice", "米饭": "rice", "生米": "rice",
  "牛奶": "whole-milk", "全脂奶": "whole-milk",
  "龙利鱼": "basa-fish",
  "鸡腿肉": "chicken-thigh", "琵琶腿": "chicken-thigh", "鸡琵琶腿": "chicken-thigh", "鸡琵琶腿（去皮）": "chicken-thigh",
  "烹调油": "olive-oil", "油": "olive-oil",
  // 蔬菜品种统一归「蔬菜」（不计宏量）
  "西兰花": "vegetables", "菠菜": "vegetables", "生菜": "vegetables",
  "番茄": "vegetables", "西红柿": "vegetables", "黄瓜": "vegetables",
  "彩椒": "vegetables", "菌菇": "vegetables", "大白菜": "vegetables",
  "胡萝卜": "vegetables", "西葫芦": "vegetables", "冬瓜": "vegetables",
  "芹菜": "vegetables", "豆角": "vegetables", "油麦菜": "vegetables",
  "娃娃菜": "vegetables", "金针菇": "vegetables", "蔬菜": "vegetables",
};

function findFood(idOrName) {
  const foods = allFoods();
  const direct = foods.find((f) => f.id === idOrName) || foods.find((f) => f.name === idOrName);
  if (direct) return direct;
  const aliasId = FOOD_ALIASES[idOrName];
  if (aliasId) return foods.find((f) => f.id === aliasId);
  return undefined;
}

// 单位标签：g→克、ml→毫升、个→个
const UNIT_LABELS = { g: "克", ml: "毫升", 个: "个" };
function unitLabel(unit) { return UNIT_LABELS[unit] || unit || "克"; }
// 每份基准的显示：/100g、/100ml、/个
function perLabel(food) {
  if ((food.per || 100) === 1) return "/" + (food.unit || "个");
  return "/100" + (food.unit === "ml" ? "ml" : "g");
}
function isZeroMacro(food) { return food.carb === 0 && food.protein === 0 && food.fat === 0; }

// 某食材某数量的碳蛋脂（克），保留 1 位小数。per 为宏量对应的基准量（默认 100）。
function foodMacros(food, amount) {
  const k = amount / (food.per || 100);
  return {
    carb: round1(food.carb * k),
    protein: round1(food.protein * k),
    fat: round1(food.fat * k),
  };
}

async function savePack() {
  if (state.mode !== "edit") { toast("只读模式，无法保存", true); return false; }
  if (state.saving) return false;
  state.saving = true;
  $("#saveState").hidden = false;
  $("#saveState").textContent = "保存中…";
  try {
    const response = await cloudFetch("/", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": `"${state.revision}"` },
      body: JSON.stringify(state.pack),
    });
    const payload = await response.json();
    if (response.status === 412) { toast("数据已被他人更新，请刷新后重试", true); return false; }
    if (!response.ok) { toast(payload.error || "保存失败", true); return false; }
    state.revision = payload.revision ?? payload.version;
    $("#saveState").textContent = "已保存";
    setTimeout(() => { $("#saveState").hidden = true; }, 1600);
    return true;
  } catch (error) {
    toast(error.message || "保存失败", true);
    return false;
  } finally {
    state.saving = false;
  }
}

function renderProfileHeader() {
  const p = state.pack.profile || {};
  const g = state.pack.goal;
  const methodName = METHOD_NAMES[state.pack.method?.id] || "未选方法";
  $("#profileTitle").textContent = `${p.gender === "male" ? "男" : "女"} · ${p.weight ?? "—"}kg · ${methodName}`;
  $("#profileMeta").textContent = `起始 ${p.startDate ?? "—"} · 每周 ${p.exerciseHours ?? 0} 小时 / ${p.exerciseTimes ?? 0} 次`;
  $("#goalKcal").textContent = g ? Math.round(g.kcal) : "—";
  $("#profileNote").textContent = g
    ? `每日目标：碳水 ${g.carb}g · 蛋白 ${g.protein}g · 脂肪 ${g.fat}g`
    : "record-only 模式，无目标";
  $("#profileHeader").hidden = false;
  $("#moduleNav").hidden = false;
  renderPlanProgress();
}

// 计划总天数：lifestyle/recomposition 按 90 天；carb-cycle 按各阶段天数累加。
function planDaysTotal() {
  const m = state.pack?.method;
  if (m?.id === "carb-cycle" && Array.isArray(m.phases) && m.phases.length) {
    return m.phases.reduce((sum, ph) => sum + (Number(ph.days) || 0), 0);
  }
  return 90;
}

// 倒计时：以 startDate 为第 1 天。返回 { total, dayNo, remaining, endLabel }，无 startDate 返回 null。
function planCountdown() {
  const p = state.pack.profile || {};
  if (!p.startDate) return null;
  const total = planDaysTotal();
  const start = new Date(p.startDate + "T00:00:00");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today - start) / 86400000); // 0 = 第 1 天
  const dayNo = Math.max(1, Math.min(diffDays + 1, total));
  const remaining = Math.max(0, total - dayNo);
  const end = new Date(start.getTime() + (total - 1) * 86400000);
  const endLabel = `${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  return { total, dayNo, remaining, endLabel };
}

// 减脂进度：以起始体重 - 最近体重 除以 起始 - 目标。无 targetWeight 返回 null。
function fatlossProgress() {
  const p = state.pack.profile || {};
  const startWeight = p.weight;
  const target = p.targetWeight;
  if (startWeight == null || target == null || startWeight === target) return null;
  const logs = state.pack.logs || {};
  let latest = null, latestDate = null;
  for (const [date, v] of Object.entries(logs)) {
    if (v?.weight != null && (latestDate === null || date > latestDate)) {
      latestDate = date; latest = Number(v.weight);
    }
  }
  const currentWeight = latest != null ? latest : startWeight;
  const lost = startWeight - currentWeight;
  const goal = startWeight - target;
  const pct = goal > 0 ? Math.max(0, Math.min(100, (lost / goal) * 100)) : 0;
  return { startWeight, currentWeight, target, lost, goal, pct };
}

// 在档案头部渲染「倒计时 + 减脂进度栏」。
function renderPlanProgress() {
  const inner = $("#profileHeader .profile-header-inner");
  if (!inner) return;
  const old = inner.querySelector(".plan-progress");
  if (old) old.remove();

  const countdown = planCountdown();
  const progress = fatlossProgress();
  if (!countdown && !progress) return;

  const box = el('<div class="plan-progress"></div>');

  if (countdown) {
    box.appendChild(el(`
      <div class="countdown-row">
        <span class="countdown-day">第 <b>${countdown.dayNo}</b> / ${countdown.total} 天</span>
        <span class="countdown-remain">剩 ${countdown.remaining} 天 · 至 ${countdown.endLabel}</span>
      </div>`));
  }

  if (progress) {
    box.appendChild(el(`
      <div class="fat-bar"><div class="fat-bar-fill" style="width:${progress.pct}%"></div></div>
      <div class="fat-meta">
        <span>已减 <b>${fmtNum(progress.lost)}</b> kg</span>
        <span>目标 ${progress.startWeight} → ${progress.target} kg</span>
        <span class="fat-pct">${Math.round(progress.pct)}%</span>
      </div>`));
  }

  inner.appendChild(box);
}

function renderToday() {
  const view = $("#view-today");
  view.innerHTML = "";

  const g = state.pack.goal;
  if (g) {
    const goalCard = el(`
      <section class="card">
        <h2><i>${icon("sun")}</i>今日目标</h2>
        <div class="macro-grid">
          <div class="macro-cell"><b>${g.carb}</b><span>碳水 g</span></div>
          <div class="macro-cell"><b>${g.protein}</b><span>蛋白 g</span></div>
          <div class="macro-cell"><b>${g.fat}</b><span>脂肪 g</span></div>
          <div class="macro-cell"><b>${Math.round(g.kcal)}</b><span>kcal</span></div>
        </div>
      </section>`);
    view.appendChild(goalCard);
  }

  const today = todayLog();
  const mealCard = el('<section class="card"><h2><i>' + icon("leaf") + '</i>今日四餐记录</h2><div class="meals-holder"></div><div class="balance-holder"></div></section>');
  const holder = mealCard.querySelector(".meals-holder");
  for (const name of MEAL_NAMES) {
    holder.appendChild(renderMealRow(name));
  }

  // 额外记录项（体重/睡眠/训练/饥饿感）
  const extraRow = el(`
    <div class="meal-row">
      <div class="meal-row-head"><b>今日状态</b><span>复盘用</span></div>
      <div class="meal-macros cols-4">
        <label>体重 kg<input type="number" min="0" step="0.1" data-extra="weight"></label>
        <label>睡眠 h<input type="number" min="0" step="0.5" data-extra="sleep"></label>
        <label>训练<input type="text" data-extra="training" placeholder="如 40min"></label>
        <label>饥饿 1-5<input type="number" min="1" max="5" step="1" data-extra="hunger"></label>
      </div>
    </div>`);
  if (today) {
    extraRow.querySelector('[data-extra="weight"]').value = today.weight ?? "";
    extraRow.querySelector('[data-extra="sleep"]').value = today.sleep ?? "";
    extraRow.querySelector('[data-extra="training"]').value = today.training ?? "";
    extraRow.querySelector('[data-extra="hunger"]').value = today.hunger ?? "";
  }
  extraRow.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", async () => {
      ensureTodayLog();
      const entry = todayLog();
      entry[input.dataset.extra] = input.value === "" ? undefined : Number(input.value) || input.value;
      await savePack();
    });
  });
  holder.appendChild(extraRow);

  const balanceHolder = mealCard.querySelector(".balance-holder");
  if (g) {
    balanceHolder.appendChild(el('<div class="balance-holder-inner"></div>'));
  } else {
    balanceHolder.appendChild(el('<p class="empty">record-only 模式，无目标可配平。</p>'));
  }
  view.appendChild(mealCard);
  renderBalance();
}

function todayLog() {
  const logs = state.pack.logs || (state.pack.logs = {});
  const today = todayDateString();
  return logs[today];
}

function ensureTodayLog() {
  const logs = state.pack.logs || (state.pack.logs = {});
  const today = todayDateString();
  if (!logs[today]) logs[today] = {};
  return logs[today];
}

function todayMeal(name) {
  const log = todayLog();
  return log?.meals?.[name];
}

function ensureMeal(name) {
  const log = ensureTodayLog();
  const meals = log.meals || (log.meals = {});
  if (!meals[name]) meals[name] = { items: [] };
  return meals[name];
}

function mealMacros(name) {
  const meal = todayMeal(name);
  const sum = { carb: 0, protein: 0, fat: 0 };
  for (const it of meal?.items || []) {
    sum.carb += it.carb || 0;
    sum.protein += it.protein || 0;
    sum.fat += it.fat || 0;
  }
  return sum;
}

// 从 weeklyPlan 找「今天」对应的 day（date === 系统今天）
function todayPlanDay() {
  const wp = state.pack.weeklyPlan;
  if (!wp?.days?.length) return null;
  const today = todayDateString();
  return wp.days.find((d) => d.date === today) || null;
}

// 当天计划里某餐的食材（{name, amount, unit}[]）
function planIngredientsFor(mealName) {
  const day = todayPlanDay();
  if (!day) return [];
  const meal = (day.meals || []).find((m) => m.name === mealName);
  return meal?.ingredients || [];
}

// 一键把「今日计划」食材写入实际记录（按 name 匹配食材库算宏量）
function applyPlanToMeal(name) {
  const plan = planIngredientsFor(name);
  if (!plan.length) return;
  const meal = ensureMeal(name);
  for (const p of plan) {
    const amount = Number(p.amount) || 0;
    if (!amount) continue;
    const food = findFood(p.name);
    if (food) {
      const m = foodMacros(food, amount);
      meal.items.push({ id: food.id, name: food.name, amount, unit: food.unit || p.unit || "g", carb: m.carb, protein: m.protein, fat: m.fat });
    } else {
      // 食材库未收录（自定义/旧餐单名）：保留原名，宏量记 0，用户可删改
      meal.items.push({ id: "plan-" + name + "-" + meal.items.length, name: p.name, amount, unit: p.unit || "g", carb: 0, protein: 0, fat: 0 });
    }
  }
  renderToday();
  savePack();
}

// 计划提示块：显示当天该餐安排，附「按计划记入」按钮
function renderPlanBlock(name, plan) {
  const box = el(`
    <div class="meal-plan">
      <div class="meal-plan-head">今日计划</div>
      <div class="meal-plan-items"></div>
      <button class="apply-plan-btn" type="button">按计划记入</button>
    </div>`);
  const holder = box.querySelector(".meal-plan-items");
  plan.forEach((x) => {
    holder.appendChild(el(`<span class="plan-item">${esc(x.name)} <b>${x.amount}${x.unit}</b></span>`));
  });
  box.querySelector(".apply-plan-btn").addEventListener("click", () => applyPlanToMeal(name));
  return box;
}

// 渲染单餐：食材列表 + 合计宏量 + 添加按钮
function renderMealRow(name) {
  const meal = todayMeal(name);
  const items = meal?.items || [];
  const sum = mealMacros(name);
  const plan = planIngredientsFor(name);

  const row = el(`
    <div class="meal-row" data-meal="${name}">
      <div class="meal-row-head">
        <b>${name}</b>
        <span>${fmtNum(sum.carb)} 碳 · ${fmtNum(sum.protein)} 蛋 · ${fmtNum(sum.fat)} 脂</span>
      </div>
      <div class="meal-items"></div>
      <button class="add-food-btn" type="button">＋ 添加食材</button>
    </div>`);

  const listHolder = row.querySelector(".meal-items");
  if (!items.length && plan.length) {
    // 当天有计划且未记录：显示计划 + 一键记入
    listHolder.appendChild(renderPlanBlock(name, plan));
  } else if (!items.length) {
    listHolder.appendChild(el('<p class="empty">尚未记录，点下方「添加食材」。</p>'));
  }
  items.forEach((it, idx) => {
    const li = el(`
      <div class="meal-item">
        <span class="meal-item-name">${esc(it.name)}</span>
        <span class="meal-item-grams">${it.amount}${it.unit || "g"}</span>
        <span class="meal-item-macros">碳${fmtNum(it.carb)} · 蛋${fmtNum(it.protein)} · 脂${fmtNum(it.fat)}</span>
        <button class="meal-item-del" type="button" data-idx="${idx}" aria-label="删除${esc(it.name)}">×</button>
      </div>`);
    listHolder.appendChild(li);
  });

  row.querySelector(".add-food-btn").addEventListener("click", () => openFoodPicker(name));
  row.querySelectorAll(".meal-item-del").forEach((btn) => {
    btn.addEventListener("click", () => removeFoodFromMeal(name, Number(btn.dataset.idx)));
  });
  return row;
}

function addFoodToMeal(name, food, amount) {
  amount = Number(amount);
  if (!food || !amount || amount <= 0) return;
  const meal = ensureMeal(name);
  const m = foodMacros(food, amount);
  meal.items.push({ id: food.id, name: food.name, amount, unit: food.unit || "g", carb: m.carb, protein: m.protein, fat: m.fat });
  renderToday();
  savePack();
}

function removeFoodFromMeal(name, idx) {
  const meal = todayMeal(name);
  if (!meal || !meal.items[idx]) return;
  meal.items.splice(idx, 1);
  renderToday();
  savePack();
}

function addCustomFood(name, carb, protein, fat) {
  const food = { id: "custom-" + Date.now(), name, carb: Number(carb) || 0, protein: Number(protein) || 0, fat: Number(fat) || 0, category: "自定义" };
  state.customFoods.push(food);
  const lib = state.pack.foodLibrary || (state.pack.foodLibrary = {});
  const custom = lib.custom || (lib.custom = []);
  custom.push({ name, carb: food.carb, protein: food.protein, fat: food.fat, category: "自定义" });
  savePack();
}

function todayDateString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function renderBalance() {
  const g = state.pack.goal;
  const inner = document.querySelector(".balance-holder-inner");
  if (!g || !inner) return;
  const sum = { carb: 0, protein: 0, fat: 0 };
  for (const name of MEAL_NAMES) {
    const m = mealMacros(name);
    sum.carb += m.carb;
    sum.protein += m.protein;
    sum.fat += m.fat;
  }
  const eatenKcal = Math.round(sum.carb * 4 + sum.protein * 4 + sum.fat * 9);
  const targetKcal = Math.round(g.kcal || (g.carb * 4 + g.protein * 4 + g.fat * 9));
  const pct = targetKcal > 0 ? Math.round((eatenKcal / targetKcal) * 100) : 0;

  const SEG_COLORS = { carb: "#2f6b4f", protein: "#5c8a6b", fat: "#a9b8a0" };
  const SEG_LABELS = { carb: "碳水", protein: "蛋白", fat: "脂肪" };
  const keys = ["carb", "protein", "fat"];

  // 配平环几何：三段弧，每段占 1/3 圆周，留 6 单位间隙
  const R = 84, CX = 98, CY = 98;
  const C = 2 * Math.PI * R;
  const seg = C / 3;
  const gap = 6;
  const segLen = seg - gap;

  let segs = "";
  keys.forEach((key, i) => {
    const target = g[key] || 0;
    const eaten = sum[key];
    const over = eaten > target && target > 0;
    const frac = target > 0 ? Math.min(eaten / target, 1) : 0;
    const fill = frac * segLen;
    const start = i * seg + gap / 2;
    const color = over ? "#e8893a" : SEG_COLORS[key];
    segs += `<circle class="seg" cx="${CX}" cy="${CY}" r="${R}" stroke="${color}" stroke-dasharray="${fill} ${C - fill}" stroke-dashoffset="${-start}"/>`;
  });

  inner.innerHTML = `
    <div class="balance-ring-wrap">
      <div class="balance-ring">
        <svg viewBox="0 0 196 196" role="img" aria-label="今日配平环">
          <circle class="track" cx="${CX}" cy="${CY}" r="${R}"/>
          ${segs}
        </svg>
        <div class="balance-ring-center">
          <b>${pct}%</b>
          <span>${eatenKcal} / ${targetKcal} kcal</span>
        </div>
      </div>
      <div class="balance-legend">
        ${keys.map((key) => {
          const target = g[key] || 0;
          const eaten = sum[key];
          const over = eaten > target && target > 0;
          const frac = target > 0 ? Math.round((eaten / target) * 100) : 0;
          const delta = eaten - target;
          return `
            <div class="balance-row">
              <span class="balance-dot" style="background:${SEG_COLORS[key]}"></span>
              <span class="lbl">${SEG_LABELS[key]}</span>
              <div class="balance-bar"><div class="balance-fill ${over ? "over" : ""}" style="width:${Math.min(frac, 100)}%"></div></div>
              <span class="num">${eaten}g / ${target}g</span>
              <span class="delta ${over ? "over" : ""}">${over ? "+" : ""}${delta}g</span>
            </div>`;
        }).join("")}
      </div>
    </div>`;
}

function renderWeek() {
  const view = $("#view-week");
  view.innerHTML = "";
  const wp = state.pack.weeklyPlan;
  if (!wp?.days?.length) {
    view.appendChild(el('<section class="card"><h2><i>' + icon("calendar") + '</i>本周餐单</h2><p class="empty">暂无周餐单数据。</p></section>'));
    return;
  }

  const planCard = el('<section class="card"><h2><i>' + icon("calendar") + '</i>七日餐单</h2><div class="days-holder"></div></section>');
  const holder = planCard.querySelector(".days-holder");
  for (const d of wp.days) {
    const dayBlock = el(`
      <div class="day-block">
        <div class="day-block-head">
          <b>D${d.day} · ${d.date} · 周${d.weekday || "—"}</b>
          ${d.reviewDay ? '<span class="review-tag">复盘日</span>' : ""}
        </div>
        <div class="day-meals"></div>
      </div>`);
    const mealsHolder = dayBlock.querySelector(".day-meals");
    for (const meal of d.meals || []) {
      const items = (meal.ingredients || [])
        .map((x) => x.amount ? `${x.name} ${x.amount}${x.unit}` : x.name)
        .join("、");
      mealsHolder.appendChild(el(`<div class="day-meal"><b>${esc(meal.name)}</b><small>${esc(meal.time || "")}</small><span>${esc(items || "—")}</span></div>`));
    }
    holder.appendChild(dayBlock);
  }
  view.appendChild(planCard);

  if (wp.shopping?.length) {
    const shopCard = el('<section class="card"><h2><i>' + icon("leaf") + '</i>采购清单</h2><ul class="shop-list"></ul></section>');
    const list = shopCard.querySelector(".shop-list");
    for (const s of wp.shopping) {
      list.appendChild(el(`<li><input type="checkbox"><span>${esc(s.name)}</span> <small style="color:var(--hint)">${esc(s.amount || "")}</small></li>`));
    }
    view.appendChild(shopCard);
  }
}

function renderReview() {
  const view = $("#view-review");
  view.innerHTML = "";

  const trendCard = el('<section class="card"><h2><i>' + icon("chart") + '</i>体重趋势</h2><div class="trend-chart"></div></section>');
  const chart = trendCard.querySelector(".trend-chart");
  chart.appendChild(buildTrendChart());
  view.appendChild(trendCard);

  const reviews = state.pack.reviews || [];
  if (reviews.length) {
    const reviewCard = el('<section class="card"><h2><i>' + icon("chart") + '</i>执行偏差与建议</h2><div class="reviews-holder"></div></section>');
    const holder = reviewCard.querySelector(".reviews-holder");
    for (const r of reviews) {
      const item = el(`
        <div class="review-item">
          <div class="date">第 ${esc(r.day ?? "")} 天${r.confirmed ? " · 已确认" : ""}</div>
          <p>${esc(r.message ?? "")}</p>
        </div>`);
      if (r.nextGoal) {
        item.appendChild(el(`<div class="next-goal">下周目标：碳水 ${r.nextGoal.carb}g · 蛋白 ${r.nextGoal.protein}g · 脂肪 ${r.nextGoal.fat}g</div>`));
      }
      holder.appendChild(item);
    }
    view.appendChild(reviewCard);
  } else {
    view.appendChild(el('<section class="card"><h2><i>' + icon("chart") + '</i>复盘</h2><p class="empty">暂无复盘记录。完成一周后由 Agent 生成。</p></section>'));
  }
}

function buildTrendChart() {
  const logs = state.pack.logs || {};
  const entries = Object.entries(logs)
    .filter(([, v]) => v?.weight != null)
    .sort(([a], [b]) => a.localeCompare(b));

  const wrapper = el('<div style="width:100%"></div>');
  if (entries.length < 2) {
    wrapper.appendChild(el('<p class="empty">' + (entries.length ? "记录不足 2 天，暂无法绘制趋势。" : "暂无体重记录。") + '</p>'));
    return wrapper;
  }

  const weights = entries.map(([, v]) => Number(v.weight));
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = max - min || 1;
  const W = 640, H = 180, PAD = 24;
  const n = entries.length;
  const x = (i) => PAD + (i * (W - PAD * 2)) / (n - 1);
  const y = (v) => H - PAD - ((v - min) / range) * (H - PAD * 2);

  const points = entries.map(([, v], i) => `${x(i)},${y(Number(v.weight))}`).join(" ");
  const svg = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="体重趋势图">
      <polyline points="${points}" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${entries.map(([, v], i) => `<circle cx="${x(i)}" cy="${y(Number(v.weight))}" r="3.5" fill="#16a34a"/>`).join("")}
      ${entries.map(([date], i) => `<text x="${x(i)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="#9aa49b">${date.slice(5)}</text>`).join("")}
      <text x="${PAD}" y="${H - PAD - ((max - min) / range) * (H - PAD * 2) + 4}" font-size="10" fill="#9aa49b">${max}kg</text>
      <text x="${PAD}" y="${H - PAD + 2}" font-size="10" fill="#9aa49b">${min}kg</text>
    </svg>`;
  wrapper.innerHTML = svg;
  return wrapper;
}

function renderMine() {
  const view = $("#view-mine");
  view.innerHTML = "";
  const p = state.pack.profile || {};
  const s = state.pack.screening || {};

  const profileCard = el(`
    <section class="card">
      <h2><i>${icon("user")}</i>档案</h2>
      <ul class="profile-list">
        <li><span>性别</span><span>${p.gender === "male" ? "男" : "女"}</span></li>
        <li><span>体重</span><span>${p.weight ?? "—"} kg</span></li>
        <li><span>每周运动</span><span>${p.exerciseHours ?? 0} 小时 / ${p.exerciseTimes ?? 0} 次</span></li>
        <li><span>起始日</span><span>${p.startDate ?? "—"}</span></li>
        <li><span>方法</span><span>${METHOD_NAMES[state.pack.method?.id] || "未选"}</span></li>
        <li><span>筛查模式</span><span>${s.mode ?? "—"}</span></li>
      </ul>
    </section>`);
  view.appendChild(profileCard);

  const sup = state.pack.supplements || {};
  const supNames = { blueberries: "蓝莓", vegetables: "蔬菜", pumpkinSeeds: "南瓜籽", nuts: "坚果" };
  const activeSups = Object.entries(sup).filter(([, v]) => v).map(([k]) => supNames[k]);
  if (activeSups.length) {
    const supCard = el('<section class="card"><h2><i>' + icon("leaf") + '</i>日常补充</h2><div class="chip-row"></div></section>');
    for (const name of activeSups) supCard.querySelector(".chip-row").appendChild(el(`<span class="chip">${name}</span>`));
    view.appendChild(supCard);
  }

  const favs = state.pack.favoriteMeals || [];
  if (favs.length) {
    const favCard = el('<section class="card"><h2><i>' + icon("leaf") + '</i>常用餐</h2><div class="chip-row"></div></section>');
    for (const f of favs) favCard.querySelector(".chip-row").appendChild(el(`<span class="chip">${esc(f.name)}</span>`));
    view.appendChild(favCard);
  }

  view.appendChild(el(`
    <section class="card">
      <h2><i>${icon("download")}</i>备份与导出</h2>
      <p class="empty">右上角下载按钮可导出当前 FatLossPack JSON；导入按钮可恢复备份。</p>
    </section>`));
}

function render() {
  if (!state.pack) return;
  renderProfileHeader();
  const active = state.tab;
  document.querySelectorAll(".module-nav button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === active);
  });
  document.querySelectorAll(".tab-view").forEach((v) => v.classList.remove("active"));
  const target = $("#view-" + active);
  if (target) target.classList.add("active");
  if (active === "today") renderToday();
  else if (active === "week") renderWeek();
  else if (active === "review") renderReview();
  else if (active === "mine") renderMine();
  applyReveal(target);
}

// 编排好的入场序列：给当前视图的卡片错峰浮现（尊重 prefers-reduced-motion）
function applyReveal(view) {
  if (!view) return;
  view.querySelectorAll(".card").forEach((card) => {
    card.classList.add("reveal");
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add("in")));
  });
}

// ==========================================================================
// 食材选择器：搜索 + 分类筛选 + 克数 + 自定义
// ==========================================================================
function openFoodPicker(mealName) {
  const dlg = document.createElement("dialog");
  dlg.className = "food-picker";
  dlg.innerHTML = `
    <div class="dialog-head">
      <div><span class="section-kicker">ADD FOOD</span><h2>添加食材到「${mealName}」</h2></div>
      <button class="icon-button" type="button" aria-label="关闭">×</button>
    </div>
    <div class="picker-body">
      <input class="picker-search" type="text" placeholder="搜索食材（如 鸡胸、燕麦）">
      <div class="picker-cats"></div>
      <div class="picker-list"></div>
    </div>
    <div class="picker-footer">
      <label class="picker-grams-label"><span class="picker-unit">克数</span> <input class="picker-grams" type="number" min="1" step="1" value="100"></label>
      <span class="picker-selected-hint">未选择食材</span>
      <button class="text-button primary-action picker-add" type="button" disabled>加入</button>
      <button class="text-button picker-custom" type="button">自定义食材</button>
    </div>`;
  document.body.appendChild(dlg);

  dlg.dataset.meal = mealName;
  dlg.dataset.selected = "";
  dlg.dataset.cat = "全部";

  dlg.querySelector(".dialog-head .icon-button").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => dlg.remove());

  const search = dlg.querySelector(".picker-search");
  search.addEventListener("input", () => renderPickerList(dlg, search.value.trim(), dlg.dataset.cat));

  renderPickerList(dlg, "", "全部");

  dlg.querySelector(".picker-add").addEventListener("click", () => {
    const food = findFood(dlg.dataset.selected);
    const amount = dlg.querySelector(".picker-grams").value;
    if (!food) { toast("请先选择食材", true); return; }
    addFoodToMeal(mealName, food, amount);
    dlg.close();
  });

  dlg.querySelector(".picker-custom").addEventListener("click", () => openCustomFoodForm(dlg));

  dlg.showModal();
}

function renderPickerList(dlg, query, cat) {
  const list = dlg.querySelector(".picker-list");
  const catBox = dlg.querySelector(".picker-cats");
  list.innerHTML = "";
  catBox.innerHTML = "";

  const cats = ["全部", ...Array.from(new Set(allFoods().map((f) => f.category)))];
  cats.forEach((c) => {
    const chip = el(`<button class="chip cat-chip ${c === cat ? "active" : ""}" type="button">${c}</button>`);
    chip.addEventListener("click", () => {
      dlg.dataset.cat = c;
      renderPickerList(dlg, dlg.querySelector(".picker-search").value.trim(), c);
    });
    catBox.appendChild(chip);
  });

  let foods = allFoods();
  if (cat && cat !== "全部") foods = foods.filter((f) => f.category === cat);
  if (query) {
    const q = query.toLowerCase();
    foods = foods.filter((f) => f.name.toLowerCase().includes(q) || (f.id || "").toLowerCase().includes(q));
  }

  foods.forEach((f) => {
    const macroText = isZeroMacro(f)
      ? "不计碳蛋脂"
      : `碳${fmtNum(f.carb)} 蛋${fmtNum(f.protein)} 脂${fmtNum(f.fat)} ${perLabel(f)}`;
    const item = el(`
      <div class="picker-item" data-id="${esc(f.id)}">
        <div class="picker-item-name"><b>${esc(f.name)}</b>${f.note ? `<small>${esc(f.note)}</small>` : ""}</div>
        <span class="picker-macros">${macroText}</span>
      </div>`);
    item.addEventListener("click", () => {
      dlg.querySelectorAll(".picker-item").forEach((x) => x.classList.remove("selected"));
      item.classList.add("selected");
      dlg.dataset.selected = f.id;
      dlg.querySelector(".picker-selected-hint").textContent = "已选：" + f.name;
      dlg.querySelector(".picker-unit").textContent = unitLabel(f.unit || "g") + "数";
      dlg.querySelector(".picker-add").disabled = false;
    });
    list.appendChild(item);
  });

  if (!foods.length) list.appendChild(el('<p class="empty">无匹配食材，点「自定义食材」添加。</p>'));
}

function openCustomFoodForm(parentDlg) {
  const dlg = document.createElement("dialog");
  dlg.className = "food-picker custom-form";
  dlg.innerHTML = `
    <div class="dialog-head">
      <div><span class="section-kicker">CUSTOM FOOD</span><h2>自定义食材</h2></div>
      <button class="icon-button" type="button" aria-label="关闭">×</button>
    </div>
    <div class="custom-form-body">
      <label>名称 <input class="cf-name" type="text" placeholder="如 蛋白棒"></label>
      <div class="custom-macros">
        <label>碳水 g <input class="cf-carb" type="number" min="0" step="0.1" placeholder="每100g"></label>
        <label>蛋白 g <input class="cf-protein" type="number" min="0" step="0.1"></label>
        <label>脂肪 g <input class="cf-fat" type="number" min="0" step="0.1"></label>
      </div>
      <p class="hint-text">按每 100g 碳蛋脂填写（看包装营养成分表）。</p>
    </div>
    <div class="dialog-footer">
      <button class="text-button cf-cancel" type="button">取消</button>
      <button class="text-button primary-action cf-save" type="button">保存</button>
    </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector(".dialog-head .icon-button").addEventListener("click", () => dlg.close());
  dlg.querySelector(".cf-cancel").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => dlg.remove());
  dlg.querySelector(".cf-save").addEventListener("click", () => {
    const name = dlg.querySelector(".cf-name").value.trim();
    const carb = dlg.querySelector(".cf-carb").value;
    const protein = dlg.querySelector(".cf-protein").value;
    const fat = dlg.querySelector(".cf-fat").value;
    if (!name) { toast("请输入名称", true); return; }
    addCustomFood(name, carb, protein, fat);
    dlg.close();
    parentDlg.close();
    toast("已保存「" + name + "」，重新打开「添加食材」即可选择");
  });
  dlg.showModal();
}

function buildTabs() {
  const main = $("#app");
  main.innerHTML = "";
  for (const tab of ["today", "week", "review", "mine"]) {
    main.appendChild(el(`<section class="tab-view" id="view-${tab}"></section>`));
  }
}

function setupNav() {
  document.querySelectorAll(".module-nav button").forEach((btn) => {
    btn.addEventListener("click", () => { state.tab = btn.dataset.tab; render(); });
  });
}

function setupDialog() {
  const dialog = $("#dataDialog");
  $("#exportButton").addEventListener("click", () => openDialogForExport());
  $("#importButton").addEventListener("click", () => openDialogForImport());
  $("#dialogClose").addEventListener("click", () => dialog.close());
  $("#dialogCancel").addEventListener("click", () => dialog.close());
  $("#formatButton").addEventListener("click", () => {
    const editor = $("#jsonEditor");
    try { editor.value = JSON.stringify(JSON.parse(editor.value), null, 2); $("#dialogError").textContent = ""; }
    catch (e) { $("#dialogError").textContent = "JSON 格式错误：" + e.message; }
  });
  $("#downloadButton").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.pack, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "FatLossPack.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    $("#jsonEditor").value = text;
  });
  $("#saveButton").addEventListener("click", async () => {
    const editor = $("#jsonEditor");
    try {
      const parsed = JSON.parse(editor.value);
      state.pack = parsed;
      render();
      dialog.close();
      await savePack();
      toast("已导入并保存");
    } catch (e) {
      $("#dialogError").textContent = "JSON 格式错误：" + e.message;
    }
  });
}

function openDialogForExport() {
  $("#jsonEditor").value = JSON.stringify(state.pack, null, 2);
  $("#dialogError").textContent = "";
  $("#saveButton").hidden = true;
  $("#importFile").hidden = true;
  $("#formatButton").hidden = true;
  $("#downloadButton").hidden = false;
  $("#dataDialog").showModal();
}

function openDialogForImport() {
  $("#jsonEditor").value = "";
  $("#dialogError").textContent = "";
  $("#saveButton").hidden = false;
  $("#importFile").hidden = false;
  $("#formatButton").hidden = false;
  $("#downloadButton").hidden = false;
  $("#dataDialog").showModal();
}

async function init() {
  hydrateIcons();
  state.mode = detectMode();
  state.endpoint = buildEndpoint();
  const badge = $("#accessBadge");
  if (state.mode === "read") {
    badge.textContent = "只读";
    badge.classList.add("readonly");
  } else {
    badge.textContent = "可编辑";
  }
  buildTabs();
  setupNav();
  setupDialog();
  try {
    await loadPack();
    await loadFoodDb();
    render();
  } catch (error) {
    console.error("加载失败:", error);
    $("#app").innerHTML = `<section class="state-view"><h1>无法打开</h1><p>${esc(error.message || "加载数据失败")}</p></section>`;
  }
}

init();
