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
  foodDb: [],        // 内置食材库（fooddb.json，只读基准）
  customFoods: [],   // 自定义/覆盖食材，持久化到 foodLibrary.custom[]
  hiddenFoods: [],   // 隐藏的内置食材 id，持久化到 foodLibrary.hidden[]
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

// 通过宿主 adapter 调用云端大模型（免密钥）。宿主未提供该能力时抛错，由调用方降级提示。
async function callLlm(messages, options = {}) {
  const hostAdapter = window.FATLOSS_HOST_ADAPTER || null;
  if (!hostAdapter) {
    throw Object.assign(new Error("当前是本地模式，云端大模型不可用"), { code: "no_cloud" });
  }
  const adapter = createFatLossHostAdapter(hostAdapter);
  if (typeof adapter.llm !== "function") {
    throw Object.assign(new Error("当前宿主未提供大模型通道"), { code: "no_llm" });
  }
  return adapter.llm({
    messages,
    onDelta: options.onDelta,
    temperature: options.temperature,
    signal: options.signal,
  });
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
// 展示用：统一保留 1 位小数（如 36 → "36.0"，避免浮点长串小数）
const fmtNum = (n) => round1(Number(n) || 0).toFixed(1);

// 统一类型（6 类）：主食 / 蛋白质 / 脂肪 / 水果 / 蔬菜 / 其他
const FOOD_TYPES = ["主食", "蛋白质", "脂肪", "水果", "蔬菜", "其他"];
// 内置细分 category → 6 类归一
const FOOD_TYPE_MAP = {
  "主食": "主食",
  "肉类蛋白": "蛋白质",
  "蛋奶": "蛋白质",
  "坚果": "脂肪",
  "蔬菜": "蔬菜",
  "水果": "水果",
  "其他": "其他",
  "自定义": "其他",
};
function foodType(f) {
  return FOOD_TYPE_MAP[f.category] || (FOOD_TYPES.includes(f.category) ? f.category : "其他");
}

async function loadFoodDb() {
  try {
    const res = await fetch("/fooddb.json");
    if (res.ok) state.foodDb = (await res.json()).items || [];
  } catch (e) {
    state.foodDb = [];
  }
  const custom = state.pack?.foodLibrary?.custom || [];
  state.customFoods = custom.map((f, i) => normalizeCustomFood(f, i));
  state.hiddenFoods = state.pack?.foodLibrary?.hidden || [];
}

// 规范化自定义食材：补齐 id/unit/per，向后兼容旧数据（旧条目只有 name/carb/protein/fat）
function normalizeCustomFood(f, i) {
  return {
    id: f.id || ("custom-" + (f.name ? f.name.replace(/\s+/g, "-") : "item") + "-" + i),
    name: f.name || "未命名食材",
    carb: Number(f.carb) || 0,
    protein: Number(f.protein) || 0,
    fat: Number(f.fat) || 0,
    unit: f.unit || "g",
    per: f.per || 100,
    category: f.category || "其他",
    note: f.note || "",
  };
}

function builtinIdSet() {
  return new Set(state.foodDb.map((f) => f.id));
}

// 最终生效食材：内置（应用覆盖、过滤隐藏）+ 纯新增自定义。
// custom 中 id 与内置同名的条目视为「覆盖内置」，隐藏的内置不参与选择与记录。
function allFoods() {
  const hidden = new Set(state.hiddenFoods || []);
  const builtinIds = builtinIdSet();
  const overrideById = {};
  for (const c of state.customFoods) {
    if (builtinIds.has(c.id)) overrideById[c.id] = c;
  }
  const result = [];
  for (const f of state.foodDb) {
    if (hidden.has(f.id)) continue;
    const ov = overrideById[f.id];
    // 覆盖只替换名称与宏量，分类保持内置原分类
    result.push(ov ? { ...f, ...ov, id: f.id, category: f.category, overridden: true } : f);
  }
  for (const c of state.customFoods) {
    if (!builtinIds.has(c.id)) result.push(c);
  }
  return result;
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
    ? `每日目标：碳水 ${fmtNum(g.carb)}g · 蛋白 ${fmtNum(g.protein)}g · 脂肪 ${fmtNum(g.fat)}g`
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
          <div class="macro-cell"><b>${fmtNum(g.carb)}</b><span>碳水 g</span></div>
          <div class="macro-cell"><b>${fmtNum(g.protein)}</b><span>蛋白 g</span></div>
          <div class="macro-cell"><b>${fmtNum(g.fat)}</b><span>脂肪 g</span></div>
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

  // 额外记录项（体重/睡眠/训练时长/饥饿感）——先填草稿，显式提交才落库
  const extraRow = el(`
    <div class="meal-row">
      <div class="meal-row-head"><b>今日状态</b><span>复盘用</span></div>
      <div class="meal-macros cols-5">
        <label>体重 kg<input type="number" min="0" step="0.1" data-extra="weight" placeholder="—"></label>
        <label>睡眠 h<input type="number" min="0" step="0.5" data-extra="sleep" placeholder="—"></label>
        <label>训练 min<input type="number" min="0" step="5" data-extra="trainingMin" placeholder="如 60"></label>
        <label>训练感受<select data-extra="trainingFeel">
          <option value="">未记录</option>
          <option value="有力">有力</option>
          <option value="一般">一般</option>
          <option value="乏力">乏力</option>
        </select></label>
        <label>饥饿 1-5<input type="number" min="1" max="5" step="1" data-extra="hunger" placeholder="—"></label>
      </div>
      <div class="status-submit-row">
        <span class="status-submit-hint">填好后点右侧提交，写入今日记录并同步云端。</span>
        <button class="text-button primary-action status-submit-btn" type="button">提交今日状态</button>
      </div>
    </div>`);
  if (today) {
    extraRow.querySelector('[data-extra="weight"]').value = today.weight ?? "";
    extraRow.querySelector('[data-extra="sleep"]').value = today.sleep ?? "";
    extraRow.querySelector('[data-extra="hunger"]').value = today.hunger ?? "";
    extraRow.querySelector('[data-extra="trainingMin"]').value = today.trainingMin ?? "";
    extraRow.querySelector('[data-extra="trainingFeel"]').value = today.trainingFeel ?? "";
  }

  const statusInputs = [...extraRow.querySelectorAll("[data-extra]")];
  const submitBtn = extraRow.querySelector(".status-submit-btn");
  const submitHint = extraRow.querySelector(".status-submit-hint");
  const readDraft = () => Object.fromEntries(statusInputs.map((i) => [i.dataset.extra, i.value.trim()]));
  let committed = readDraft();

  const refreshSubmitState = () => {
    const dirty = JSON.stringify(readDraft()) !== JSON.stringify(committed);
    submitBtn.classList.toggle("is-dirty", dirty);
    submitBtn.textContent = dirty ? "提交今日状态 ·" : "提交今日状态";
    submitHint.textContent = dirty
      ? "有未提交的修改"
      : "填好后点右侧提交，写入今日记录并同步云端。";
    return dirty;
  };

  statusInputs.forEach((input) => {
    input.addEventListener("input", refreshSubmitState);
    input.addEventListener("change", refreshSubmitState);
  });

  submitBtn.addEventListener("click", async () => {
    const draft = readDraft();
    if (!refreshSubmitState()) { toast("今日状态没有改动"); return; }
    ensureTodayLog();
    const entry = todayLog();
    for (const [key, raw] of Object.entries(draft)) {
      if (raw === "") { delete entry[key]; continue; }
      const num = Number(raw);
      entry[key] = Number.isFinite(num) ? num : raw;
    }
    await savePack();
    committed = readDraft();
    submitBtn.classList.remove("is-dirty");
    submitBtn.textContent = "已提交 ✓";
    submitHint.textContent = "已写入今日记录";
    toast("今日状态已提交");
    setTimeout(() => {
      if (!submitBtn.isConnected) return;
      submitBtn.textContent = "提交今日状态";
    }, 1800);
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
  const favForMeal = favoriteForMeal(name);

  const row = el(`
    <div class="meal-row" data-meal="${name}">
      <div class="meal-row-head">
        <b>${name}</b>
        <span>${fmtNum(sum.carb)} 碳 · ${fmtNum(sum.protein)} 蛋 · ${fmtNum(sum.fat)} 脂</span>
      </div>
      <div class="meal-items"></div>
      <button class="add-food-btn" type="button">＋ 添加食材</button>
      ${(favForMeal || items.length) ? `
      <div class="meal-actions">
        ${favForMeal ? `<span class="fav-hint">常用餐 · ${esc(favForMeal.name)}</span><button class="text-button fav-apply-btn" type="button">记入</button>` : ""}
        ${items.length ? `<button class="text-button fav-save-btn" type="button">存为常用餐</button>` : ""}
      </div>` : ""}
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
        <div class="meal-item-controls">
          <div class="stepper">
            <button class="step-btn step-minus" type="button" data-idx="${idx}" aria-label="减少${esc(it.name)}">−</button>
            <button class="step-value" type="button" data-idx="${idx}" title="点击精确修改" aria-label="修改${esc(it.name)}份量">${it.amount}<span class="unit">${it.unit || "g"}</span></button>
            <button class="step-btn step-plus" type="button" data-idx="${idx}" aria-label="增加${esc(it.name)}">＋</button>
          </div>
          <button class="meal-item-del" type="button" data-idx="${idx}" aria-label="删除${esc(it.name)}">×</button>
        </div>
      </div>`);
    listHolder.appendChild(li);
  });

  row.querySelector(".add-food-btn").addEventListener("click", () => openFoodPicker(name));
  const applyBtn = row.querySelector(".fav-apply-btn");
  if (applyBtn) applyBtn.addEventListener("click", () => applyFavoriteToMeal(name));
  const saveBtn = row.querySelector(".fav-save-btn");
  if (saveBtn) saveBtn.addEventListener("click", () => saveMealAsFavorite(name));
  row.querySelectorAll(".step-minus").forEach((btn) => {
    btn.addEventListener("click", () => adjustFoodInMeal(name, Number(btn.dataset.idx), -1));
  });
  row.querySelectorAll(".step-plus").forEach((btn) => {
    btn.addEventListener("click", () => adjustFoodInMeal(name, Number(btn.dataset.idx), +1));
  });
  row.querySelectorAll(".step-value").forEach((btn) => {
    btn.addEventListener("click", () => inlineEditAmount(btn, name, Number(btn.dataset.idx)));
  });
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

// 步长：按单位智能定（个 ±1 / ml ±50 / g 及其他 ±10）
function stepFor(unit) {
  if (unit === "个") return 1;
  if (unit === "ml") return 50;
  return 10;
}

// 调整某餐某食材份量：按步长增减、重算宏量，减到 ≤0 则删除该行
function adjustFoodInMeal(name, idx, delta) {
  const meal = todayMeal(name);
  const item = meal?.items?.[idx];
  if (!item) return;
  const step = stepFor(item.unit);
  const amount = round1((Number(item.amount) || 0) + delta * step);
  if (amount <= 0) {
    meal.items.splice(idx, 1);
  } else {
    const food = findFood(item.id);
    let m;
    if (food) {
      m = foodMacros(food, amount);
      item.id = food.id;
      item.name = food.name;
      item.unit = food.unit || item.unit;
    } else {
      // 食材库已不含该食材（被删/隐藏）：按原宏量密度线性缩放，保持快照一致
      const k = amount / (Number(item.amount) || 1);
      m = { carb: round1((item.carb || 0) * k), protein: round1((item.protein || 0) * k), fat: round1((item.fat || 0) * k) };
    }
    item.amount = amount;
    item.carb = m.carb;
    item.protein = m.protein;
    item.fat = m.fat;
  }
  renderToday();
  savePack();
}

// 精准修改某餐某食材份量：直接设为精确值并重算宏量，≤0 则删除
function setFoodAmount(name, idx, value) {
  const meal = todayMeal(name);
  const item = meal?.items?.[idx];
  if (!item) return;
  const amount = round1(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) {
    meal.items.splice(idx, 1);
  } else {
    const food = findFood(item.id);
    let m;
    if (food) {
      m = foodMacros(food, amount);
      item.id = food.id;
      item.name = food.name;
      item.unit = food.unit || item.unit;
    } else {
      const k = amount / (Number(item.amount) || 1);
      m = { carb: round1((item.carb || 0) * k), protein: round1((item.protein || 0) * k), fat: round1((item.fat || 0) * k) };
    }
    item.amount = amount;
    item.carb = m.carb;
    item.protein = m.protein;
    item.fat = m.fat;
  }
  renderToday();
  savePack();
}

// 点击克重 → 就地变输入框，输入精确值后回车/失焦确认，Esc 取消
function inlineEditAmount(btn, name, idx) {
  const meal = todayMeal(name);
  const item = meal?.items?.[idx];
  if (!item) return;
  const input = document.createElement("input");
  input.type = "number";
  input.className = "step-value-input";
  input.min = "0";
  input.step = "0.1";
  input.inputMode = "decimal";
  input.value = item.amount;
  btn.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const val = Number(input.value);
    if (Number.isFinite(val) && val > 0) setFoodAmount(name, idx, val);
    else renderToday();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { done = true; renderToday(); }
  });
  input.addEventListener("blur", commit);
}

// —— 常用餐（favoriteMeals）——
function favoriteForMeal(mealName) {
  const favs = state.pack.favoriteMeals || [];
  return favs.find((f) => f.mealName === mealName);
}

// 一键把某餐的常用餐写入实际记录（优先按 id、fallback name 匹配食材库算宏量）
function applyFavoriteToMeal(mealName) {
  const fav = favoriteForMeal(mealName);
  if (!fav?.ingredients?.length) return;
  const meal = ensureMeal(mealName);
  for (const ing of fav.ingredients) {
    const amount = Number(ing.amount) || 0;
    if (!amount) continue;
    const food = findFood(ing.id) || findFood(ing.name);
    if (food) {
      const m = foodMacros(food, amount);
      meal.items.push({ id: food.id, name: food.name, amount, unit: food.unit || ing.unit || "g", carb: m.carb, protein: m.protein, fat: m.fat });
    } else {
      meal.items.push({ id: "fav-" + Date.now() + "-" + meal.items.length, name: ing.name, amount, unit: ing.unit || "g", carb: 0, protein: 0, fat: 0 });
    }
  }
  renderToday();
  savePack();
}

// 把当前这餐已记录的内容存为（或更新）常用餐
function saveMealAsFavorite(mealName) {
  const meal = todayMeal(mealName);
  const items = meal?.items || [];
  if (!items.length) { toast("该餐还没有记录", true); return; }
  const favs = state.pack.favoriteMeals || (state.pack.favoriteMeals = []);
  const existing = favs.find((f) => f.mealName === mealName);
  const ingredients = items.map((it) => ({ id: it.id, name: it.name, amount: it.amount, unit: it.unit || "g" }));
  if (existing) {
    existing.ingredients = ingredients;
    if (!existing.name) existing.name = mealName + "常用";
    toast("已更新常用餐「" + existing.name + "」");
  } else {
    favs.push({ id: "fav-" + Date.now(), name: mealName + "常用", mealName, ingredients });
    toast("已存为常用餐「" + mealName + "常用」");
  }
  savePack();
  renderToday();
}

function removeFavoriteMeal(id) {
  const favs = state.pack.favoriteMeals || [];
  state.pack.favoriteMeals = favs.filter((f) => f.id !== id);
  savePack();
}

// 编辑常用餐：改名 + 调整每样食材份量 + 删除食材
function openFavoriteEditor(id) {
  const favs = state.pack.favoriteMeals || [];
  const fav = favs.find((f) => f.id === id);
  if (!fav) return;

  const dlg = document.createElement("dialog");
  dlg.className = "food-picker fav-editor";
  dlg.innerHTML = `
    <div class="dialog-head">
      <div><span class="section-kicker">EDIT FAVORITE</span><h2>编辑常用餐</h2></div>
      <button class="icon-button" type="button" aria-label="关闭">×</button>
    </div>
    <div class="fav-editor-body">
      <label class="fav-editor-name">名称<input type="text" class="fav-name-input" maxlength="24" value="${esc(fav.name)}"></label>
      <div class="fav-editor-hint">归属「${esc(fav.mealName)}」 · 可调份量或删除食材，改完点保存。</div>
      <div class="fav-editor-list"></div>
    </div>
    <footer class="dialog-footer">
      <button class="text-button fav-editor-cancel" type="button">取消</button>
      <button class="text-button primary-action fav-editor-save" type="button">保存</button>
    </footer>`;
  document.body.appendChild(dlg);
  dlg.querySelector(".dialog-head .icon-button").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => dlg.remove());

  const list = dlg.querySelector(".fav-editor-list");
  const rows = (fav.ingredients || []).map((ing) => ({ ...ing }));

  const renderRows = () => {
    list.innerHTML = "";
    if (!rows.length) {
      list.appendChild(el('<p class="empty">食材已清空，保存后这份常用餐将不含任何食材。</p>'));
      return;
    }
    rows.forEach((ing, idx) => {
      const row = el(`
        <div class="fav-editor-row">
          <span class="fav-editor-row-name">${esc(ing.name)}</span>
          <div class="stepper">
            <button class="step-btn fe-minus" type="button" aria-label="减少${esc(ing.name)}">−</button>
            <input class="fe-amount" type="number" min="0" step="1" value="${ing.amount}" aria-label="${esc(ing.name)}份量">
            <span class="fe-unit">${esc(ing.unit || "g")}</span>
            <button class="step-btn fe-plus" type="button" aria-label="增加${esc(ing.name)}">＋</button>
          </div>
          <button class="meal-item-del fe-del" type="button" aria-label="删除${esc(ing.name)}">×</button>
        </div>`);
      row.querySelector(".fe-amount").addEventListener("input", (e) => { rows[idx].amount = Number(e.target.value) || 0; });
      row.querySelector(".fe-minus").addEventListener("click", () => {
        rows[idx].amount = round1(Math.max(0, (Number(rows[idx].amount) || 0) - stepFor(rows[idx].unit)));
        renderRows();
      });
      row.querySelector(".fe-plus").addEventListener("click", () => {
        rows[idx].amount = round1((Number(rows[idx].amount) || 0) + stepFor(rows[idx].unit));
        renderRows();
      });
      row.querySelector(".fe-del").addEventListener("click", () => { rows.splice(idx, 1); renderRows(); });
      list.appendChild(row);
    });
  };
  renderRows();

  dlg.querySelector(".fav-editor-cancel").addEventListener("click", () => dlg.close());
  dlg.querySelector(".fav-editor-save").addEventListener("click", async () => {
    const name = dlg.querySelector(".fav-name-input").value.trim();
    if (!name) { toast("名称不能为空", true); return; }
    const target = favs.find((f) => f.id === id);
    if (!target) return;
    target.name = name;
    target.ingredients = rows
      .filter((r) => Number(r.amount) > 0)
      .map((r) => ({ id: r.id, name: r.name, amount: r.amount, unit: r.unit || "g" }));
    await savePack();
    dlg.close();
    renderMine();
    toast("已保存常用餐「" + name + "」");
  });

  dlg.showModal();
}

// 统一写入一条自定义/覆盖条目：id 为空→纯新增（生成 custom-*）；id 命中内置→覆盖；id 命中已有→更新。
function upsertFoodEntry(input) {
  const id = input.id || ("custom-" + Date.now());
  const idx = state.customFoods.findIndex((f) => f.id === id);
  const prev = idx >= 0 ? state.customFoods[idx] : null;
  const entry = {
    id,
    name: input.name,
    carb: Number(input.carb) || 0,
    protein: Number(input.protein) || 0,
    fat: Number(input.fat) || 0,
    unit: input.unit || "g",
    per: Number(input.per) || 100,
    category: input.category || "其他",
    note: input.note ?? prev?.note ?? "",
  };
  if (idx >= 0) state.customFoods[idx] = entry;
  else state.customFoods.push(entry);
  persistCustomFoods();
  savePack();
  return entry;
}

function removeCustomFood(id) {
  state.customFoods = state.customFoods.filter((f) => f.id !== id);
  persistCustomFoods();
  savePack();
}

function hideFood(id) {
  if (!state.hiddenFoods.includes(id)) state.hiddenFoods.push(id);
  persistHidden();
  savePack();
}

function unhideFood(id) {
  state.hiddenFoods = state.hiddenFoods.filter((x) => x !== id);
  persistHidden();
  savePack();
}

function isHidden(id) { return state.hiddenFoods.includes(id); }
function isOverridden(id) { return state.customFoods.some((f) => f.id === id && builtinIdSet().has(id)); }

// 把内存中的自定义食材列表回写进 pack.foodLibrary.custom（随 savePack 存入私有云）
function persistCustomFoods() {
  const lib = state.pack.foodLibrary || (state.pack.foodLibrary = {});
  lib.custom = state.customFoods.map((f) => ({ ...f }));
}

// 把隐藏的内置食材 id 回写进 pack.foodLibrary.hidden
function persistHidden() {
  const lib = state.pack.foodLibrary || (state.pack.foodLibrary = {});
  lib.hidden = [...state.hiddenFoods];
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

  const SEG_COLORS = { carb: "var(--primary)", protein: "var(--moss)", fat: "var(--sage)" };
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
    const color = over ? "var(--accent)" : SEG_COLORS[key];
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
              <span class="num">${fmtNum(eaten)}g / ${fmtNum(target)}g</span>
              <span class="delta ${over ? "over" : ""}">${over ? "+" : ""}${fmtNum(delta)}g</span>
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

// ============================== 复盘控制台 ==============================
// 方向：工业实用（Industrial）—— 暖黑底 / 火焰橙强调 / 等宽数字 / 四角括号面板。
// 图表全部为运行时内联 SVG，零外部依赖；数据单一来源：logs + profile。

const CS_DAY_MS = 86400000;

function dayNumOf(date, startDate) {
  return Math.round((new Date(date + "T12:00:00") - new Date(startDate + "T12:00:00")) / CS_DAY_MS) + 1;
}

function isReviewDay(date) { // 周六起周期，周五为复盘日
  return new Date(date + "T12:00:00").getDay() === 5;
}

// 某日实际碳蛋脂总量：遍历当日各餐 items 的宏量快照求和（含热量）
function dayIntake(entry) {
  const sum = { carb: 0, protein: 0, fat: 0 };
  const meals = entry?.meals || {};
  for (const meal of Object.values(meals)) {
    for (const it of meal?.items || []) {
      sum.carb += it.carb || 0;
      sum.protein += it.protein || 0;
      sum.fat += it.fat || 0;
    }
  }
  sum.kcal = Math.round(sum.carb * 4 + sum.protein * 4 + sum.fat * 9);
  return sum;
}

// 执行偏差（自动）：每日实际摄入 vs 目标，公式得出，无需手动记录。
// 返回按日期倒序的偏差数组；无饮食记录的日期跳过。
function computeDeviations(logs, goal) {
  const rows = [];
  if (!goal) return rows;
  for (const [date, entry] of Object.entries(logs)) {
    if (!entry?.meals) continue;
    const a = dayIntake(entry);
    if (!a.carb && !a.protein && !a.fat) continue; // 空餐跳过
    const d = {
      date,
      carb: a.carb, protein: a.protein, fat: a.fat, kcal: a.kcal,
      dCarb: round1(a.carb - goal.carb),
      dProtein: round1(a.protein - goal.protein),
      dFat: round1(a.fat - goal.fat),
      dKcal: a.kcal - Math.round(goal.kcal || 0),
    };
    d.carbPct = goal.carb ? Math.round((d.dCarb / goal.carb) * 100) : 0;
    d.proteinPct = goal.protein ? Math.round((d.dProtein / goal.protein) * 100) : 0;
    d.fatPct = goal.fat ? Math.round((d.dFat / goal.fat) * 100) : 0;
    const ps = [d.carbPct, d.proteinPct, d.fatPct];
    // 判定：任一项 > +10% → 超量；任一项 < −10% → 不足；否则达标
    d.status = ps.some((x) => x > 10) ? "over" : ps.some((x) => x < -10) ? "under" : "ok";
    rows.push(d);
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

// ==========================================================================
// 复盘引擎：把 review.md 的判定规则代码化（确定性，不调用大模型）
// 口径来源 references/methods/*.md 与 references/review.md
// ==========================================================================

// 判定阈值（写入文档时必须与此一致）
const TARGET_DROP_PCT = 1.0;   // 每周理想降幅；低于此值说明偏慢
const FAST_DROP_PCT = 1.5;     // 每周降幅超过此值说明过快，触发保护性加碳水
const STAGE_RESET_PCT = 3.0;   // 阶段累计降幅达到此值 → 按新体重全量重算

// 生活化减脂系数：[碳水, 蛋白, 脂肪] g/kg，按每周运动时长分档
// <4h→档1，<6h→档2，<8h→档3，否则档4（与 lifestyle.md 一致，不外推）
const LIFESTYLE_COEF = {
  male:   [[2.2, 1.4, 0.8], [2.5, 1.6, 0.9], [3.0, 1.7, 1.0], [3.5, 1.8, 1.0]],
  female: [[2.0, 1.4, 1.0], [2.2, 1.6, 1.1], [2.5, 1.7, 1.1], [3.0, 1.8, 1.2]],
};
const LIFESTYLE_TIER_LABELS = ["每周 2–3 小时", "每周 4–5 小时", "每周 6–7 小时", "每周 8–9 小时"];

function lifestyleTier(hours) {
  const h = Number(hours) || 0;
  return h < 4 ? 0 : h < 6 ? 1 : h < 8 ? 2 : 3;
}

// 按当前体重与方法口径全量重算碳蛋脂（阶段降 ≥3% 时触发）。
// 返回 { carb, protein, fat, kcal, basis }；方法参数缺失时返回 null，由调用方提示去对话里重算。
function recomputeGoalForWeight(weight, methodId) {
  const w = Number(weight);
  if (!w) return null;
  const pack = state.pack || {};
  const p = pack.profile || {};
  const gender = p.gender === "female" ? "female" : "male";
  const method = methodId || pack.method?.id || "lifestyle";
  const build = (c, pr, f, basis) => ({
    carb: round1(w * c),
    protein: round1(w * pr),
    fat: round1(w * f),
    kcal: Math.round(w * c * 4 + w * pr * 4 + w * f * 9),
    basis,
  });

  if (method === "lifestyle") {
    const tier = lifestyleTier(p.exerciseHours);
    const [c, pr, f] = LIFESTYLE_COEF[gender][tier];
    return build(c, pr, f, `${LIFESTYLE_TIER_LABELS[tier]} · ${w}kg × ${c}/${pr}/${f} g/kg`);
  }

  if (method === "carb-cycle") {
    const phases = pack.method?.phases;
    const cur = Array.isArray(phases) && phases.length
      ? (phases.find((x) => x && x.active) || phases[0])
      : null;
    if (!cur) return null;
    const fatRaw = cur.fat && typeof cur.fat === "object" ? (cur.fat[gender] ?? cur.fat.male) : cur.fat;
    const c = Number(cur.carb), pr = Number(cur.protein), f = Number(fatRaw);
    if (!c || !pr || !f) return null;
    return build(c, pr, f, `${cur.name || "当前阶段"} · ${w}kg × ${c}/${pr}/${f} g/kg`);
  }

  if (method === "recomposition") {
    const sp = pack.method?.startPoint;
    if (!sp) return null;
    const c = Number(sp.carb), pr = Number(sp.protein), f = Number(sp.fat);
    if (!c || !pr || !f) return null;
    return build(c, pr, f, `起点系数 ${w}kg × ${c}/${pr}/${f} g/kg`);
  }

  return null;
}

// 复盘窗口：最近 7 个「有体重记录」的日期（不足 7 天就用现有全部）。
// 不用自然日切片，避免用户漏记几天后窗口整体落空。
function reviewWindow(logs) {
  const entries = Object.entries(logs || {})
    .filter(([, v]) => v && v.weight != null && Number.isFinite(Number(v.weight)))
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.slice(-7);
}

// 复盘引擎主函数：只读取数据、给出建议，不写库。
// 返回 { ready, ... }；ready=false 时 reason 说明还缺什么数据。
function computeReview() {
  const pack = state.pack || {};
  const logs = pack.logs || {};
  const goal = pack.goal || null;
  const p = pack.profile || {};
  const methodId = pack.method?.id || "lifestyle";
  const isRecomp = methodId === "recomposition";

  const entries = reviewWindow(logs);
  if (entries.length < 3) {
    return { ready: false, reason: "体重记录不足 3 天，暂无法复盘。先在「今日 → 今日状态」提交体重（0.1kg 精度即可）。" };
  }
  if (!goal) {
    return { ready: false, reason: "还没有设定目标碳蛋脂，先在对话里生成第一版方案。" };
  }

  const [startDay, startEntry] = entries[0];
  const [endDay, endEntry] = entries[entries.length - 1];
  const wStart = Number(startEntry.weight);
  const wEnd = Number(endEntry.weight);
  const spanDays = Math.max(1, Math.round(
    (new Date(endDay + "T12:00:00") - new Date(startDay + "T12:00:00")) / CS_DAY_MS
  ));
  // 折算成「每周降幅%」：窗口不足 7 天时按比例外推，便于统一口径比较
  const rawDropPct = ((wStart - wEnd) / Math.max(0.0001, wStart)) * 100;
  const weeklyDropPct = rawDropPct * (7 / spanDays);

  const inWindow = Object.entries(logs).filter(([d]) => d >= startDay && d <= endDay);
  const hungers = inWindow.map(([, v]) => Number(v?.hunger)).filter((n) => Number.isFinite(n) && n > 0);
  const hunger5 = hungers.filter((n) => n === 5).length;
  const hunger4plus = hungers.filter((n) => n >= 4).length;
  const avgHunger = hungers.length ? hungers.reduce((a, b) => a + b, 0) / hungers.length : null;
  const feelDown = inWindow.filter(([, v]) => v?.trainingFeel === "乏力").length;
  const feelUp = inWindow.filter(([, v]) => v?.trainingFeel === "有力").length;
  const sleeps = inWindow.map(([, v]) => Number(v?.sleep)).filter((n) => Number.isFinite(n) && n > 0);
  const avgSleep = sleeps.length ? sleeps.reduce((a, b) => a + b, 0) / sleeps.length : null;

  // 阶段累计降幅（相对上次重算基准）→ 是否触发全量重算
  const baseline = Number(goal.stageBaselineWeight) || Number(p.weight) || wStart;
  const stageDropPct = ((baseline - wEnd) / Math.max(0.0001, baseline)) * 100;
  const stageReset = stageDropPct >= STAGE_RESET_PCT;

  let verdict = "ontrack";
  let deltaCarb = 0;
  let reason = "";

  if (isRecomp) {
    // 增肌减脂并行：以主观状态为主，方向与生活化减脂相反（胃口差 → 降碳水）
    if (feelDown >= 2 || (avgSleep != null && avgSleep < 6.5)) {
      verdict = "fatigued"; deltaCarb = -10;
      reason = `本周训练感受「乏力」${feelDown} 次${avgSleep != null ? `、睡眠均值 ${avgSleep.toFixed(1)}h` : ""}，先下调碳水减轻负担，并回看睡眠与有氧量。`;
    } else if (hunger4plus >= 3 && feelUp >= 2) {
      verdict = "craving-ok"; deltaCarb = +10;
      reason = `本周明显渴望（饥饿感 ≥4 达 ${hunger4plus} 天）且训练「有力」${feelUp} 次，状态良好，碳水小幅上调。`;
    } else if (hungers.length >= 3 && avgHunger != null && avgHunger <= 2) {
      verdict = "low-appetite"; deltaCarb = -10;
      reason = `本周饥饿感均值 ${avgHunger.toFixed(1)} 偏低，胃口下降或偏饱，碳水下调。`;
    } else {
      verdict = "ontrack";
      reason = "状态信号平稳（渴望/训练/睡眠/食欲无异常），维持当前目标与缺口。";
    }
  } else if (weeklyDropPct > FAST_DROP_PCT) {
    verdict = "fast"; deltaCarb = +30;
    reason = `近 ${spanDays} 天折算周降幅 ${weeklyDropPct.toFixed(2)}%，快于安全线 ${FAST_DROP_PCT}%，碳水 +30g 优先保可持续性。`;
  } else if (hunger5 > 0) {
    verdict = "hungry"; deltaCarb = +30;
    reason = `本周有 ${hunger5} 天饥饿感达到 5，碳水 +30g 优先保可持续性。`;
  } else if (hunger4plus >= 2) {
    verdict = "mild-hungry"; deltaCarb = +10;
    reason = `本周 ${hunger4plus} 天饥饿感 ≥4，碳水 +10g。`;
  } else if (feelDown >= 2) {
    verdict = "fatigued"; deltaCarb = +10;
    reason = `本周训练感受「乏力」${feelDown} 次，碳水 +10g 观察恢复。`;
  } else if (weeklyDropPct < TARGET_DROP_PCT) {
    verdict = "slow"; deltaCarb = -10;
    reason = `近 ${spanDays} 天折算周降幅 ${weeklyDropPct.toFixed(2)}% < ${TARGET_DROP_PCT}%，碳水 −10g。`;
  } else {
    verdict = "ontrack";
    reason = `近 ${spanDays} 天折算周降幅 ${weeklyDropPct.toFixed(2)}% 接近 ${TARGET_DROP_PCT}%，保持当前目标。`;
  }

  // 建议目标：全量重算优先于单点碳水调整
  let nextGoal = null;
  let recalcBasis = null;
  if (stageReset) {
    const rec = recomputeGoalForWeight(wEnd, methodId);
    if (rec) {
      nextGoal = { carb: rec.carb, protein: rec.protein, fat: rec.fat, kcal: rec.kcal };
      recalcBasis = rec.basis;
      reason = `阶段累计下降 ${stageDropPct.toFixed(2)}%（≥${STAGE_RESET_PCT}%），按新体重 ${wEnd}kg 全量重算：${rec.basis}。`;
      verdict = "recalc";
    } else {
      reason = `阶段累计下降 ${stageDropPct.toFixed(2)}%（≥${STAGE_RESET_PCT}%），应全量重算，但当前方法缺少重算参数，请在对话里重算后回填。`;
    }
  }
  if (!nextGoal && deltaCarb !== 0) {
    const newCarb = round1(goal.carb + deltaCarb);
    nextGoal = {
      carb: newCarb,
      protein: goal.protein,
      fat: goal.fat,
      kcal: Math.round(newCarb * 4 + goal.protein * 4 + goal.fat * 9),
    };
  }

  // 「同次不叠加」：同一窗口已确认过就不再重复应用
  const adjustLog = Array.isArray(goal.adjustLog) ? goal.adjustLog : [];
  const alreadyAdjusted = adjustLog.some((a) => a && a.windowEnd === endDay);

  return {
    ready: true,
    methodId,
    isRecomp,
    windowStart: startDay,
    windowEnd: endDay,
    spanDays,
    sampleDays: entries.length,
    loggedDays: inWindow.length,
    metrics: { wStart, wEnd, rawDropPct, weeklyDropPct, hunger5, hunger4plus, avgHunger, feelDown, feelUp, avgSleep, stageDropPct, baseline },
    verdict,
    reason,
    deltaCarb,
    stageReset,
    recalcBasis,
    nextGoal,
    prevGoal: { carb: goal.carb, protein: goal.protein, fat: goal.fat, kcal: goal.kcal },
    alreadyAdjusted,
  };
}

// 确认生效：写入 goal（含 reviewDay / stageBaselineWeight / adjustLog）与 reviews[]。
async function applyReview(result) {
  const pack = state.pack;
  const p = pack.profile || {};
  const goal = pack.goal || (pack.goal = {});
  const startDate = p.startDate || result.windowStart;

  if (result.nextGoal) Object.assign(goal, result.nextGoal);
  if (goal.reviewDay == null) goal.reviewDay = 5; // 周五
  if (goal.stageBaselineWeight == null) goal.stageBaselineWeight = Number(p.weight) || result.metrics.wEnd;
  if (result.stageReset) goal.stageBaselineWeight = result.metrics.wEnd; // 重算后基准归位

  const adjustLog = Array.isArray(goal.adjustLog) ? goal.adjustLog : (goal.adjustLog = []);
  adjustLog.push({
    at: new Date().toISOString(),
    windowStart: result.windowStart,
    windowEnd: result.windowEnd,
    verdict: result.verdict,
    deltaCarb: result.deltaCarb,
    stageReset: !!result.stageReset,
  });

  const reviews = pack.reviews || (pack.reviews = []);
  reviews.push({
    day: `D${dayNumOf(result.windowEnd, startDate)}`,
    windowStart: result.windowStart,
    windowEnd: result.windowEnd,
    message: result.reason,
    nextGoal: result.nextGoal ? { ...result.nextGoal } : null,
    confirmed: true,
    confirmedAt: new Date().toISOString(),
  });

  // 归档：复盘记录同时进入只读历史
  const history = pack.history || (pack.history = { weeks: [], reviews: [] });
  if (!Array.isArray(history.reviews)) history.reviews = [];
  history.reviews.push({
    day: `D${dayNumOf(result.windowEnd, startDate)}`,
    windowStart: result.windowStart,
    windowEnd: result.windowEnd,
    message: result.reason,
    deltaCarb: result.deltaCarb,
  });

  const ok = await savePack();
  if (ok) toast("复盘已生效，新目标已写入");
  return ok;
}

// ==========================================================================
// 排餐器：把「复盘结论 + 目标宏量 + 食材库」交给云端大模型生成下一阶段餐单
// 输出严格 JSON，校验通过后才允许落库；失败给出明确原因，不静默失败。
// ==========================================================================

const PLAN_SYSTEM_PROMPT = [
  "你是减脂餐单生成器。只输出 JSON，不输出解释、前言或任何 JSON 之外的文字。",
  "只能使用用户提供的食材库中的食材，ingredients[].name 必须与食材库名称完全一致。",
  "蔬菜与蓝莓不计入碳蛋脂目标，但可以出现在餐单里。",
  "每天三餐（早餐/午餐/晚餐），每餐 2-5 样食材，份量单位用 g / ml / 个。",
  "每天碳蛋脂合计尽量接近目标，单项偏差控制在 ±10% 以内。",
  "7 天中有且仅有 1 天的 reviewDay 为 true，就是给定的复盘日那一天。",
].join("");

// 生成未来 7 天日期骨架（从今天起）交给模型照抄，避免模型自行推算日历出错。
function planDateSkeleton() {
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  const out = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() + i * CS_DAY_MS);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ day: i + 1, date: iso, weekday: names[d.getDay()], reviewDay: d.getDay() === 5 });
  }
  return out;
}

function buildPlanningPrompt(review) {
  const pack = state.pack || {};
  const goal = review.nextGoal || pack.goal || {};
  const foods = allFoods().filter((f) => f && f.name);
  const selectedIds = new Set(pack.foodLibrary?.selected || []);
  const preferred = foods.filter((f) => selectedIds.has(f.id));
  const skeleton = planDateSkeleton();
  // 复用食材库的基准量口径：per=100 → 每 100g / 100ml，per=1 → 每 个
  const fmtFood = (f) =>
    `- ${f.name}（${foodType(f)}）每${perLabel(f).slice(1)}：碳 ${f.carb}g 蛋 ${f.protein}g 脂 ${f.fat}g`;

  return [
    `【目标】每日 碳水 ${goal.carb}g、蛋白 ${goal.protein}g、脂肪 ${goal.fat}g（约 ${goal.kcal} kcal）。`,
    "",
    "【优选食材】优先从这些常用食材里组合：",
    preferred.length ? preferred.map(fmtFood).join("\n") : "（无，改用下方完整食材库）",
    "",
    "【完整食材库】如需替换，只能从以下食材中选择，名称必须完全一致：",
    foods.map(fmtFood).join("\n"),
    "",
    "【日期骨架】严格按以下 7 天输出，date / weekday / reviewDay 原样照抄，不要改动：",
    skeleton.map((s) => `day ${s.day} → ${s.date}（${s.weekday}）reviewDay=${s.reviewDay}`).join("\n"),
    "",
    "【餐次】每天固定三餐：早餐 08:00、午餐 12:30、晚餐 18:30。",
    "",
    "【输出格式】只输出下面这个结构的 JSON：",
    '{"days":[{"day":1,"date":"YYYY-MM-DD","weekday":"X","reviewDay":false,"meals":[{"id":"m1","name":"早餐","time":"08:00","ingredients":[{"name":"燕麦片","amount":60,"unit":"g"}]}]}]}',
  ].join("\n");
}

// 从模型输出里稳健地取 JSON（容错 Markdown 围栏与前后多余文字）
function parsePlanJson(text) {
  let s = String(text || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

// 结构校验：天数、餐次名、食材字段、复盘日恰好 1 天
function validateGeneratedPlan(plan) {
  if (!plan || !Array.isArray(plan.days) || !plan.days.length) throw new Error("模型没有返回 days 数组");
  let reviewDays = 0;
  for (const d of plan.days) {
    if (!d || !d.date || !Array.isArray(d.meals) || !d.meals.length) {
      throw new Error("餐单结构不完整（缺少 date 或 meals）");
    }
    if (d.reviewDay) reviewDays++;
    for (const m of d.meals) {
      if (!MEAL_NAMES.includes(m?.name)) throw new Error(`餐次名不合法：${m?.name}`);
      if (!Array.isArray(m.ingredients) || !m.ingredients.length) throw new Error(`「${m.name}」没有食材`);
      for (const it of m.ingredients) {
        if (!it?.name) throw new Error("存在没有名称的食材");
        if (!Number.isFinite(Number(it.amount)) || Number(it.amount) <= 0) throw new Error(`「${it.name}」份量不合法`);
        if (!it.unit) it.unit = "g";
      }
    }
  }
  if (plan.days.length === 7 && reviewDays !== 1) throw new Error(`复盘日应为 1 天，实际 ${reviewDays} 天`);
  return plan;
}

// 调模型生成下一阶段餐单（onDelta 用于流式进度）
async function generatePlanViaLlm(review, options = {}) {
  const messages = [
    { role: "system", content: PLAN_SYSTEM_PROMPT },
    { role: "user", content: buildPlanningPrompt(review) },
  ];
  const res = await callLlm(messages, { onDelta: options.onDelta, temperature: 0.7, signal: options.signal });
  const plan = validateGeneratedPlan(parsePlanJson(res.text));
  return { plan, model: res.model };
}

// 落库：旧周归档进 history.weeks，再写入新 weeklyPlan
async function applyGeneratedPlan(plan, review) {
  const pack = state.pack;
  const goal = review.nextGoal || pack.goal || {};
  const history = pack.history || (pack.history = { weeks: [], reviews: [] });
  if (!Array.isArray(history.weeks)) history.weeks = [];
  if (pack.weeklyPlan && Array.isArray(pack.weeklyPlan.days) && pack.weeklyPlan.days.length) {
    history.weeks.push({
      weekIndex: pack.weeklyPlan.weekIndex ?? null,
      startDate: pack.weeklyPlan.startDate ?? null,
      archivedAt: new Date().toISOString(),
      goalAtThatTime: pack.goal
        ? { carb: pack.goal.carb, protein: pack.goal.protein, fat: pack.goal.fat }
        : null,
      days: pack.weeklyPlan.days,
    });
  }
  const weekIndex = (Number(pack.weeklyPlan?.weekIndex) || 0) + 1;
  pack.weeklyPlan = {
    confirmed: true,
    weekIndex,
    startDate: plan.days[0].date,
    generatedBy: "cloud-llm",
    generatedAt: new Date().toISOString(),
    goal,
    days: plan.days,
    shopping: pack.weeklyPlan?.shopping || [],
    nutritionTotals: pack.weeklyPlan?.nutritionTotals || null,
  };
  const ok = await savePack();
  if (ok) toast(`第 ${weekIndex} 周餐单已生成并应用`);
  return ok;
}

function renderReview() {
  const view = $("#view-review");
  view.innerHTML = "";

  const p = state.pack.profile || {};
  const g = state.pack.goal;
  const startDate = p.startDate || "2026-09-22";
  const period = 90;
  const target = Number(p.targetWeight) || 55;

  const logs = state.pack.logs || {};
  const weightEntries = Object.entries(logs).filter(([, v]) => v?.weight != null).sort(([a], [b]) => a.localeCompare(b));
  const loggedDays = Object.keys(logs).length;
  const weights = weightEntries.map(([, v]) => Number(v.weight));
  const startWeight = weights.length ? weights[0] : (Number(p.weight) || 0);
  const currentWeight = weights.length ? weights[weights.length - 1] : startWeight;
  const lost = Math.max(0, startWeight - currentWeight);
  const remaining = Math.max(0, currentWeight - target);
  const pct = Math.min(100, Math.round((lost / Math.max(0.0001, startWeight - target)) * 100));

  const sleeps = Object.values(logs).filter((v) => v?.sleep != null).map((v) => Number(v.sleep));
  const avgSleep = sleeps.length ? sleeps.reduce((a, b) => a + b, 0) / sleeps.length : null;

  const trainEntries = Object.entries(logs)
    .filter(([, v]) => Number(v?.trainingMin) > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const trainMins = trainEntries.map(([, v]) => Number(v.trainingMin));
  const trainDays = trainMins.length;
  const trainTotal = trainMins.reduce((a, b) => a + b, 0);
  const trainAvg = trainDays ? Math.round(trainTotal / trainDays) : 0;

  const hungerEntries = Object.entries(logs).filter(([, v]) => v?.hunger != null).sort(([a], [b]) => a.localeCompare(b));
  const sleepEntries = Object.entries(logs).filter(([, v]) => v?.sleep != null).sort(([a], [b]) => a.localeCompare(b));

  const lastDayNum = weightEntries.length ? dayNumOf(weightEntries[weightEntries.length - 1][0], startDate) : 1;
  const deviations = computeDeviations(logs, g);

  view.appendChild(el(`
    <section class="card">
      <h2><i>${icon("sun")}</i>阶段目标</h2>
      <div class="macro-grid">
        <div class="macro-cell"><b>${g ? fmtNum(g.carb) : "—"}</b><span>碳水 g</span></div>
        <div class="macro-cell"><b>${g ? fmtNum(g.protein) : "—"}</b><span>蛋白 g</span></div>
        <div class="macro-cell"><b>${g ? fmtNum(g.fat) : "—"}</b><span>脂肪 g</span></div>
        <div class="macro-cell"><b>${g ? Math.round(g.kcal) : "—"}</b><span>kcal</span></div>
      </div>
      <div class="fat-bar" style="margin-top:16px"><div class="fat-bar-fill" style="width:${pct}%"></div></div>
      <div class="fat-meta">
        <span>起点 <b>${startWeight.toFixed(2)}</b> kg</span>
        <span>当前 <b>${currentWeight.toFixed(2)}</b> kg</span>
        <span>目标 <b>${target}</b> kg</span>
        <span class="fat-pct">${pct}%</span>
      </div>
    </section>`));

  view.appendChild(el(`
    <section class="card">
      <h2><i>${icon("chart")}</i>体重趋势</h2>
      <p class="hint-text" style="margin:0 0 6px">单位 kg · 琥珀点为复盘日 · 已记录 ${loggedDays} 天</p>
      ${weightEntries.length >= 2 ? weightTrendSVG(weightEntries, startDate, currentWeight) : '<p class="empty">记录不足 2 天，暂无法绘制趋势。</p>'}
    </section>`));

  view.appendChild(el(`
    <section class="card">
      <h2><i>${icon("chart")}</i>睡眠 & 训练</h2>
      <div class="review-grid2">
        <div class="review-panel">
          <div class="review-panel-title">每日睡眠时长</div>
          <div class="review-panel-hint">单位 h · 目标约 7h · 均值 ${avgSleep != null ? avgSleep.toFixed(1) : "—"}h</div>
          ${sleepEntries.length ? barsSVG(sleepEntries, "sleep", startDate, { yMax: Math.max(10, ...sleeps), gridStep: 5, color: "var(--moss)" }) : '<p class="empty">暂无睡眠记录</p>'},
        </div>
        <div class="review-panel">
          <div class="review-panel-title">每日训练时长</div>
          <div class="review-panel-hint">单位 min · 共 ${trainDays} 天 · 累计 ${trainTotal} min${trainDays ? ` · 次均 ${trainAvg} min` : ""}</div>
          ${trainEntries.length ? barsSVG(trainEntries, "trainingMin", startDate, { yMax: Math.max(60, ...trainMins), gridStep: 30, color: "var(--primary)", label: "每日训练时长" }) : '<p class="empty">暂无训练时长——在「今日 → 今日状态」填「训练 min」提交后显示。</p>'}
        </div>
      </div>
    </section>`));

  view.appendChild(el(`
    <section class="card">
      <h2><i>${icon("chart")}</i>饥饿感</h2>
      <p class="hint-text" style="margin:0 0 6px">每日 1–5 · 数值越低越饱满</p>
      ${hungerEntries.length ? barsSVG(hungerEntries, "hunger", startDate, { yMax: 5, gridStep: 2.5, color: "var(--accent)" }) : '<p class="empty">暂无饥饿感记录——在「今日 → 今日状态」填写 1-5。</p>'}
    </section>`));

  view.appendChild(el(`
    <section class="card">
      <h2><i>${icon("leaf")}</i>执行偏差</h2>
      <p class="hint-text" style="margin:0 0 12px">每日实际摄入 vs 目标，自动计算 · 单项偏差 ≤±10% 记为达标</p>
      ${deviationHTML(deviations, g, startDate)}
    </section>`));

  view.appendChild(reviewAdvisorCard());
  view.appendChild(planStudioCard());
}

// —— 本周复盘卡：内置规则自动判定，确认后才生效 ——
function reviewAdvisorCard() {
  const card = el(`
    <section class="card">
      <h2><i>${icon("sun")}</i>本周复盘 · 自动判定</h2>
      <p class="hint-text" style="margin:0 0 12px">按复盘规则自动核算最近记录并给出目标调整建议；确认后才会写入。</p>
      <div class="advisor-body"></div>
    </section>`);
  const body = card.querySelector(".advisor-body");

  const paint = () => {
    body.innerHTML = "";
    const r = computeReview();
    if (!r.ready) {
      body.appendChild(el(`<p class="empty">${esc(r.reason)}</p>`));
      return;
    }
    const m = r.metrics;
    const verdictMap = {
      fast: ["下降过快", "alert"], hungry: ["饥饿偏高", "alert"],
      "mild-hungry": ["轻微饥饿", "warn"], fatigued: ["训练乏力", "warn"],
      slow: ["进度偏慢", "warn"], ontrack: ["按计划推进", "ok"],
      recalc: ["触发全量重算", "recalc"], "craving-ok": ["状态良好", "ok"],
      "low-appetite": ["胃口偏低", "warn"],
    };
    const [vLabel, vCls] = verdictMap[r.verdict] || ["已判定", "ok"];

    const metrics = [
      [fmtNum(m.weeklyDropPct) + "%", "折算周降幅"],
      [m.hunger4plus + " 天", "饥饿感 ≥4"],
      [m.feelDown + " 次", "训练乏力"],
      [fmtNum(m.stageDropPct) + "%", "阶段累计降幅"],
    ].map(([v, k]) => `<div class="am-cell"><b>${v}</b><span>${k}</span></div>`).join("");

    const next = r.nextGoal;
    const rows = [
      ["碳水", r.prevGoal.carb, next ? next.carb : null, "g"],
      ["蛋白", r.prevGoal.protein, next ? next.protein : null, "g"],
      ["脂肪", r.prevGoal.fat, next ? next.fat : null, "g"],
      ["热量", r.prevGoal.kcal, next ? next.kcal : null, ""],
    ].map(([label, a, b, unit]) => {
      const to = b == null ? a : b;
      const diff = round1(to - a);
      const cls = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
      const sign = diff > 0 ? "+" : "";
      return `<div class="gc-row"><span>${label}</span><span>${fmtNum(a)}</span><span>${fmtNum(to)}</span><span class="gc-diff ${cls}">${diff === 0 ? "—" : sign + fmtNum(diff) + unit}</span></div>`;
    }).join("");

    body.appendChild(el(`
      <div class="advisor-inner">
        <div class="advisor-head">
          <span class="advisor-verdict ${vCls}">${vLabel}</span>
          <span class="advisor-window">${r.windowStart.slice(5)} → ${r.windowEnd.slice(5)} · 样本 ${r.sampleDays} 天</span>
        </div>
        <div class="advisor-reason">${esc(r.reason)}</div>
        <div class="advisor-metrics">${metrics}</div>
        <div class="goal-compare">
          <div class="gc-row gc-head"><span>营养素</span><span>当前</span><span>建议</span><span>变化</span></div>
          ${rows}
        </div>
      </div>`));

    const actions = el(`
      <div class="advisor-actions">
        <span class="advisor-note"></span>
        <button class="text-button primary-action advisor-apply" type="button"></button>
      </div>`);
    const note = actions.querySelector(".advisor-note");
    const btn = actions.querySelector(".advisor-apply");

    if (r.alreadyAdjusted) {
      note.textContent = "本窗口已应用过调整，不会重复叠加。";
      btn.textContent = "本窗口已生效";
      btn.disabled = true;
    } else {
      note.textContent = next ? "确认后写入目标，并把本周记录归档。" : "本次判定无需调整目标，确认后仅记录复盘。";
      btn.textContent = next ? "确认并生效" : "确认复盘记录";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "应用中…";
        const ok = await applyReview(r);
        if (ok) render();
        else { btn.disabled = false; btn.textContent = "确认并生效"; }
      });
    }
    body.appendChild(actions);
  };

  paint();
  return card;
}

// —— 下一阶段餐单卡：云端生成 → 预览 → 应用 ——
function planStudioCard() {
  const card = el(`
    <section class="card">
      <h2><i>${icon("calendar")}</i>下一阶段餐单</h2>
      <p class="hint-text" style="margin:0 0 12px">按目标宏量，用云端大模型从你的食材库排 7 天餐单；生成后可预览，点「应用到本周计划」才写入。</p>
      <div class="studio-body"></div>
    </section>`);
  const body = card.querySelector(".studio-body");
  let pending = null;

  const renderIdle = () => {
    pending = null;
    const r = computeReview();
    const g = (r.ready && r.nextGoal) || state.pack.goal || {};
    body.innerHTML = "";
    body.appendChild(el(`
      <div class="studio-idle">
        <div class="studio-goal">将按 碳水 ${fmtNum(g.carb)}g · 蛋白 ${fmtNum(g.protein)}g · 脂肪 ${fmtNum(g.fat)}g 排餐</div>
        <div class="studio-row">
          <span class="studio-note">${r.ready ? "生成约需 20–60 秒" : esc(r.reason)}</span>
          <button class="text-button primary-action studio-run" type="button"${r.ready ? "" : " disabled"}>生成下一阶段餐单</button>
        </div>
      </div>`));
    const runBtn = body.querySelector(".studio-run");
    if (runBtn && r.ready) runBtn.addEventListener("click", () => run());
  };

  const run = async () => {
    const r = computeReview();
    if (!r.ready) { toast(r.reason, true); return; }
    body.innerHTML = "";
    const box = el(`
      <div class="studio-running">
        <div class="studio-bar"><div class="studio-bar-fill"></div></div>
        <div class="studio-run-text">正在生成餐单…</div>
        <div class="studio-run-meta">已接收 <b class="studio-chars">0</b> 字</div>
      </div>`);
    body.appendChild(box);
    const chars = box.querySelector(".studio-chars");
    let n = 0;
    try {
      const { plan, model } = await generatePlanViaLlm(r, {
        onDelta: (d) => { n += d.length; chars.textContent = String(n); },
      });
      pending = { plan, review: r, model };
      renderPreview();
    } catch (error) {
      const code = error?.code || "";
      const hint = code === "no_cloud" ? "当前为本地模式，云端大模型不可用。"
        : code === "no_llm" ? "宿主未接入大模型通道。"
        : code === "no_model" ? "云端暂无可用模型，请稍后再试。"
        : (error?.message || "生成失败");
      body.innerHTML = "";
      body.appendChild(el(`
        <div class="studio-error">
          <p>生成失败：${esc(hint)}</p>
          <button class="text-button studio-retry" type="button">重试</button>
        </div>`));
      body.querySelector(".studio-retry").addEventListener("click", () => run());
    }
  };

  const renderPreview = () => {
    const { plan, review, model } = pending;
    const goal = review.nextGoal || state.pack.goal || {};
    const within = (v, t) => (t ? Math.abs(v - t) / t <= 0.12 : true);
    const days = plan.days.map((d) => {
      const sum = planDayMacros(d);
      const meals = d.meals
        .map((mm) => `<div class="sp-meal"><b>${esc(mm.name)}</b>${mm.ingredients.map((i) => `${esc(i.name)} ${i.amount}${esc(i.unit)}`).join(" · ")}</div>`)
        .join("");
      return `
        <div class="sp-day">
          <div class="sp-day-head"><b>D${d.day}</b><span>${d.date.slice(5)} ${esc(d.weekday)}</span>${d.reviewDay ? '<span class="review-tag">复盘日</span>' : ""}</div>
          ${meals}
          <div class="sp-macros">
            <span class="${within(sum.carb, goal.carb) ? "ok" : "off"}">碳 ${fmtNum(sum.carb)}g</span>
            <span class="${within(sum.protein, goal.protein) ? "ok" : "off"}">蛋 ${fmtNum(sum.protein)}g</span>
            <span class="${within(sum.fat, goal.fat) ? "ok" : "off"}">脂 ${fmtNum(sum.fat)}g</span>
            <span class="sp-kcal">${sum.kcal} kcal</span>
          </div>
        </div>`;
    }).join("");
    body.innerHTML = "";
    body.appendChild(el(`
      <div class="studio-preview">
        <div class="studio-preview-head">已生成 ${plan.days.length} 天 · ${esc(model || "云端模型")} · 绿色表示落在目标 ±12% 内</div>
        <div class="sp-list">${days}</div>
        <div class="studio-actions">
          <button class="text-button studio-redo" type="button">重新生成</button>
          <button class="text-button primary-action studio-apply" type="button">应用到本周计划</button>
        </div>
      </div>`));
    body.querySelector(".studio-redo").addEventListener("click", () => run());
    body.querySelector(".studio-apply").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "应用中…";
      const ok = await applyGeneratedPlan(pending.plan, pending.review);
      if (ok) render();
      else { btn.disabled = false; btn.textContent = "应用到本周计划"; }
    });
  };

  renderIdle();
  return card;
}

// 生成餐单某天的宏量合计（按食材库名称折算；蔬菜/蓝莓等零宏量食材自动不计）
function planDayMacros(day) {
  const sum = { carb: 0, protein: 0, fat: 0 };
  for (const meal of day.meals || []) {
    for (const it of meal.ingredients || []) {
      const food = findFood(it.name);
      if (!food) continue;
      const m = foodMacros(food, Number(it.amount) || 0);
      sum.carb += m.carb;
      sum.protein += m.protein;
      sum.fat += m.fat;
    }
  }
  sum.carb = round1(sum.carb);
  sum.protein = round1(sum.protein);
  sum.fat = round1(sum.fat);
  sum.kcal = Math.round(sum.carb * 4 + sum.protein * 4 + sum.fat * 9);
  return sum;
}

// —— 体重趋势：折线 + 渐变面积 + 复盘日金点 ——
function weightTrendSVG(entries, startDate, currentWeight) {
  const W = 1000, H = 320, padL = 52, padR = 78, padT = 26, padB = 44;
  const ws = entries.map(([, v]) => Number(v.weight));
  const n = entries.length;
  const min = Math.min(...ws), max = Math.max(...ws);
  const lo = Math.floor((min - 0.15) * 10) / 10, hi = Math.ceil((max + 0.15) * 10) / 10;
  const x = (i) => padL + (i * (W - padL - padR)) / Math.max(1, n - 1);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    grid += `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" stroke="var(--line)" stroke-width="1"/>
      <text x="${padL - 10}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="cs-svg-tick">${v.toFixed(1)}</text>`;
  }
  let xlabels = "";
  entries.forEach(([date], i) => {
    const d = dayNumOf(date, startDate);
    if (d === 1 || d % 4 === 0 || i === n - 1) xlabels += `<text x="${x(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="cs-svg-tick">D${d}</text>`;
  });

  const line = entries.map(([, v], i) => `${x(i).toFixed(1)},${y(Number(v.weight)).toFixed(1)}`).join(" ");
  const area = `M${x(0).toFixed(1)},${y(ws[0]).toFixed(1)} ` +
    entries.map(([, v], i) => `L${x(i).toFixed(1)},${y(Number(v.weight)).toFixed(1)}`).join(" ") +
    ` L${x(n - 1).toFixed(1)},${H - padB} L${x(0).toFixed(1)},${H - padB} Z`;

  const dots = entries.map(([date, v], i) => {
    const cx = x(i).toFixed(1), cy = y(Number(v.weight)).toFixed(1);
    return isReviewDay(date)
      ? `<circle cx="${cx}" cy="${cy}" r="6" fill="var(--accent)"/>`
      : `<circle cx="${cx}" cy="${cy}" r="4" fill="var(--surface)" stroke="var(--primary)" stroke-width="2"/>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="cs-svg" role="img" aria-label="每日体重变化曲线">
    <defs><linearGradient id="csWGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--primary)" stop-opacity="0.28"/>
      <stop offset="1" stop-color="var(--primary)" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}${xlabels}
    <path d="${area}" fill="url(#csWGrad)"/>
    <polyline points="${line}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    <text x="${(x(n - 1) + 10).toFixed(1)}" y="${(y(currentWeight) + 5).toFixed(1)}" class="cs-svg-last">${currentWeight.toFixed(2)}kg</text>
  </svg>`;
}

// —— 通用柱状图（睡眠 / 训练时长 / 饥饿感）——
function barsSVG(entries, key, startDate, { yMax, gridStep, color, label }) {
  const W = 560, H = 260, padL = 36, padR = 10, padT = 16, padB = 34;
  const n = entries.length;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / n;
  const bw = Math.min(18, slot * 0.55);
  const y = (v) => padT + (1 - v / yMax) * plotH;

  let grid = "";
  for (let g = 0; g <= yMax + 0.001; g += gridStep) {
    grid += `<line x1="${padL}" y1="${y(g).toFixed(1)}" x2="${W - padR}" y2="${y(g).toFixed(1)}" stroke="var(--line)" stroke-width="1"/>
      <text x="${padL - 8}" y="${(y(g) + 4).toFixed(1)}" text-anchor="end" class="cs-svg-tick">${g % 1 ? g.toFixed(1) : g}</text>`;
  }
  const bars = entries.map(([date, v], i) => {
    const val = Number(v[key]) || 0;
    const cx = padL + slot * i + slot / 2;
    return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y(val).toFixed(1)}" width="${bw.toFixed(1)}" height="${(plotH + padT - y(val)).toFixed(1)}" rx="3" fill="${color}"/>`;
  }).join("");
  const labels = entries.map(([date], i) => {
    const d = dayNumOf(date, startDate);
    return (d % 2 === 1 || i === n - 1)
      ? `<text x="${(padL + slot * i + slot / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="cs-svg-tick">D${d}</text>`
      : "";
  }).join("");
  const ariaLabel = label || (key === "sleep" ? "每日睡眠时长" : "每日饥饿感");
  return `<svg viewBox="0 0 ${W} ${H}" class="cs-svg" role="img" aria-label="${ariaLabel}">${grid}${bars}${labels}</svg>`;
}

// —— 执行偏差：自动计算的实际 vs 目标，逐日列出 ——
function deviationHTML(deviations, goal, startDate) {
  if (!deviations.length) {
    return '<p class="empty">暂无饮食记录。在「今日」记录四餐后，这里会自动按「实际 − 目标」算出每日碳蛋脂偏差。</p>';
  }
  const rows = deviations.slice(0, 14).map((d) => {
    const day = dayNumOf(d.date, startDate);
    const statusMap = { ok: ["达标", "ok"], over: ["超量", "over"], under: ["不足", "under"] };
    const [statusLabel, statusCls] = statusMap[d.status] || statusMap.ok;
    const macroRow = (label, actual, targetVal, delta, pct) => {
      const cls = delta > 0 ? "over" : delta < 0 ? "under" : "ok";
      const sign = delta > 0 ? "+" : "";
      return `<span class="dev-macro ${cls}">${label} ${fmtNum(actual)} / ${fmtNum(targetVal)}g <em>${sign}${fmtNum(delta)}g · ${pct > 0 ? "+" : ""}${pct}%</em></span>`;
    };
    return `
      <div class="dev-row">
        <div class="dev-head">
          <span class="dev-day">D${day}</span>
          <span class="dev-date">${d.date.slice(5)}</span>
          <span class="dev-status ${statusCls}">${statusLabel}</span>
        </div>
        <div class="dev-macros">
          ${macroRow("碳水", d.carb, goal.carb, d.dCarb, d.carbPct)}
          ${macroRow("蛋白", d.protein, goal.protein, d.dProtein, d.proteinPct)}
          ${macroRow("脂肪", d.fat, goal.fat, d.dFat, d.fatPct)}
        </div>
      </div>`;
  }).join("");
  return `<div class="dev-list">${rows}</div>`;
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
    const favCard = el('<section class="card"><h2><i>' + icon("leaf") + '</i>常用餐</h2><div class="fav-list"></div><p class="empty">在「今日」页某餐点「存为常用餐」新增或更新；点「记入」一键填回当天记录；点「编辑」可改名称与份量。</p></section>');
    const holder = favCard.querySelector(".fav-list");
    favs.forEach((f) => {
      const summary = (f.ingredients || []).map((i) => `${esc(i.name)} ${i.amount}${i.unit}`).join(" · ");
      const row = el(`
        <div class="foodlib-item">
          <div class="foodlib-item-info">
            <b>${esc(f.name)}</b>
            <span class="foodlib-macros"><small>${esc(f.mealName)}</small> · ${summary}</span>
          </div>
          <div class="foodlib-item-actions">
            <button class="text-button fav-edit" type="button" data-id="${esc(f.id)}">编辑</button>
            <button class="text-button fav-del" type="button" data-id="${esc(f.id)}">删除</button>
          </div>
        </div>`);
      row.querySelector(".fav-edit").addEventListener("click", () => openFavoriteEditor(f.id));
      row.querySelector(".fav-del").addEventListener("click", () => {
        if (window.confirm("确定删除常用餐「" + f.name + "」？")) {
          removeFavoriteMeal(f.id);
          renderMine();
          toast("已删除「" + f.name + "」");
        }
      });
      holder.appendChild(row);
    });
    view.appendChild(favCard);
  }

  const pureCustom = state.customFoods.filter((c) => !builtinIdSet().has(c.id));
  const builtinCount = state.foodDb.length;
  const customCount = pureCustom.length;
  const overrideCount = state.customFoods.length - customCount;
  const hiddenCount = state.hiddenFoods.length;
  const libSummary = `内置 ${builtinCount} 个 + 自定义 ${customCount} 个` + (overrideCount ? `（已覆盖 ${overrideCount} 个）` : "") + (hiddenCount ? `（已隐藏 ${hiddenCount} 个）` : "");
  const foodLibCard = el(`
    <section class="card">
      <h2><i>${icon("leaf")}</i>食材库</h2>
      <p class="empty">${libSummary}。可覆盖内置碳蛋脂、隐藏不想要的、增改删自定义，全部保存在你的私有云端。</p>
      ${customCount ? `<div class="chip-row" style="margin-bottom:14px">${pureCustom.slice(0, 8).map((f) => `<span class="chip">${esc(f.name)}</span>`).join("")}${customCount > 8 ? `<span class="chip">+${customCount - 8}</span>` : ""}</div>` : ""}
      <button class="add-food-btn open-foodlib-btn" type="button">管理食材库（覆盖 / 隐藏 / 增改删）</button>
    </section>`);
  foodLibCard.querySelector(".open-foodlib-btn").addEventListener("click", openCustomFoodLibrary);
  view.appendChild(foodLibCard);

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
      <button class="text-button picker-custom" type="button">＋ 新增</button>
      <button class="text-button primary-action picker-add" type="button" disabled>加入</button>
      <button class="text-button picker-manage" type="button">管理库</button>
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
  dlg.querySelector(".picker-manage").addEventListener("click", () => {
    dlg.close();
    openCustomFoodLibrary();
  });

  dlg.showModal();
}

function renderPickerList(dlg, query, cat) {
  const list = dlg.querySelector(".picker-list");
  const catBox = dlg.querySelector(".picker-cats");
  list.innerHTML = "";
  catBox.innerHTML = "";

  const cats = ["全部", ...FOOD_TYPES];
  cats.forEach((c) => {
    const chip = el(`<button class="chip cat-chip ${c === cat ? "active" : ""}" type="button">${c}</button>`);
    chip.addEventListener("click", () => {
      dlg.dataset.cat = c;
      renderPickerList(dlg, dlg.querySelector(".picker-search").value.trim(), c);
    });
    catBox.appendChild(chip);
  });

  let foods = allFoods();
  if (cat && cat !== "全部") foods = foods.filter((f) => foodType(f) === cat);
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

  if (!foods.length) list.appendChild(el('<p class="empty">无匹配食材，点「＋ 新增」录入，或「管理库」调整。</p>'));
}

function openCustomFoodForm(parentDlg, editingFood) {
  const dlg = document.createElement("dialog");
  dlg.className = "food-picker custom-form";
  const isEdit = !!editingFood;
  const isBuiltin = isEdit && builtinIdSet().has(editingFood.id);
  const src = editingFood ? { ...editingFood, unit: editingFood.unit || "g", per: editingFood.per || 100 } : null;
  const v = (key, fallback) => src ? String(src[key] ?? "") : fallback;
  const title = isEdit ? (isBuiltin ? "覆盖内置食材" : "编辑自定义食材") : "新增食材";
  const kicker = isBuiltin ? "OVERRIDE BUILT-IN" : "CUSTOM FOOD";
  const selType = src ? foodType(src) : "其他";
  dlg.innerHTML = `
    <div class="dialog-head">
      <div><span class="section-kicker">${kicker}</span><h2>${title}</h2></div>
      <button class="icon-button" type="button" aria-label="关闭">×</button>
    </div>
    <div class="custom-form-body">
      <label>名称 <input class="cf-name" type="text" placeholder="如 蛋白棒" value="${esc(v("name", ""))}"></label>
      <div class="custom-macros">
        <label>碳水 g <input class="cf-carb" type="number" min="0" step="0.1" placeholder="每100g" value="${esc(v("carb", ""))}"></label>
        <label>蛋白 g <input class="cf-protein" type="number" min="0" step="0.1" value="${esc(v("protein", ""))}"></label>
        <label>脂肪 g <input class="cf-fat" type="number" min="0" step="0.1" value="${esc(v("fat", ""))}"></label>
      </div>
      <div class="custom-unit-row">
        <label>单位
          <select class="cf-unit">
            <option value="g" ${src?.unit === "g" ? "selected" : ""}>克 (g)</option>
            <option value="ml" ${src?.unit === "ml" ? "selected" : ""}>毫升 (ml)</option>
            <option value="个" ${src?.unit === "个" ? "selected" : ""}>个</option>
          </select>
        </label>
        <label>基准量
          <select class="cf-per">
            <option value="100" ${src?.per === 100 ? "selected" : ""}>每 100 g/ml</option>
            <option value="1" ${src?.per === 1 ? "selected" : ""}>每 1 个</option>
          </select>
        </label>
      </div>
      ${!isBuiltin ? `
      <div class="custom-unit-row">
        <label>类型
          <select class="cf-category">
            ${FOOD_TYPES.map((t) => `<option value="${t}" ${t === selType ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </label>
      </div>` : ""}
      <p class="hint-text">${isBuiltin ? "修改会覆盖内置值（存私有云），可随时「还原」恢复内置原值。" : "按包装营养成分表填写每 100g（或每份）的碳蛋脂。"}</p>
    </div>
    <div class="dialog-footer">
      <button class="text-button cf-cancel" type="button">取消</button>
      <button class="text-button primary-action cf-save" type="button">${isEdit ? "保存修改" : "保存"}</button>
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
    const unit = dlg.querySelector(".cf-unit").value;
    const per = Number(dlg.querySelector(".cf-per").value) || 100;
    const category = isBuiltin ? editingFood.category : dlg.querySelector(".cf-category").value;
    if (!name) { toast("请输入名称", true); return; }
    upsertFoodEntry({ id: editingFood?.id, name, carb, protein, fat, unit, per, category });
    toast(isBuiltin ? "已覆盖「" + name + "」" : (isEdit ? "已更新「" + name + "」" : "已保存「" + name + "」"));
    dlg.close();
    refreshParent(parentDlg);
  });
  dlg.showModal();
}

// 保存后按父窗口类型刷新：食材库刷新列表；食物选择器刷新列表并保持打开
function refreshParent(parentDlg) {
  if (!parentDlg) return;
  if (parentDlg.querySelector(".foodlib-list")) {
    parentDlg.dispatchEvent(new CustomEvent("foodlib-refresh"));
  } else if (parentDlg.querySelector(".picker-list")) {
    renderPickerList(parentDlg, parentDlg.querySelector(".picker-search").value.trim(), parentDlg.dataset.cat);
  } else {
    parentDlg.close();
  }
}

// 食材库管理：系统内置 + 自定义食材，统一增 / 改 / 删 / 隐藏（改动存私有云）
function openCustomFoodLibrary() {
  const dlg = document.createElement("dialog");
  dlg.className = "food-picker food-library";
  dlg.innerHTML = `
    <div class="dialog-head">
      <div><span class="section-kicker">FOOD LIBRARY</span><h2>食材库</h2></div>
      <button class="icon-button" type="button" aria-label="关闭">×</button>
    </div>
    <div class="foodlib-body">
      <p class="hint-text">内置食材可「覆盖」碳蛋脂、可「隐藏」不想要的；自定义食材可增改删。改动都存私有云。</p>
      <div class="foodlib-filter"></div>
      <div class="foodlib-section-label">系统内置食材</div>
      <div class="foodlib-list foodlib-builtin"></div>
      <div class="foodlib-section-label">我的自定义食材</div>
      <div class="foodlib-list foodlib-custom"></div>
    </div>
    <div class="dialog-footer">
      <button class="text-button foodlib-add" type="button">＋ 新增食材</button>
      <button class="text-button primary-action foodlib-done" type="button">完成</button>
    </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector(".dialog-head .icon-button").addEventListener("click", () => dlg.close());
  dlg.querySelector(".foodlib-done").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => { dlg.remove(); if (state.tab === "mine") renderMine(); });
  dlg.addEventListener("foodlib-refresh", renderList);
  dlg.querySelector(".foodlib-add").addEventListener("click", () => openCustomFoodForm(dlg, null));
  let filterType = "全部";

  function macroText(f) {
    return isZeroMacro(f) ? "不计碳蛋脂" : `碳 ${fmtNum(f.carb)} · 蛋 ${fmtNum(f.protein)} · 脂 ${fmtNum(f.fat)} ${perLabel(f)}`;
  }

  function renderList() {
    const builtinList = dlg.querySelector(".foodlib-builtin");
    const customList = dlg.querySelector(".foodlib-custom");
    builtinList.innerHTML = "";
    customList.innerHTML = "";

    // —— 类型筛选 chips ——
    const filterBox = dlg.querySelector(".foodlib-filter");
    filterBox.innerHTML = "";
    ["全部", ...FOOD_TYPES].forEach((t) => {
      const chip = el(`<button class="chip cat-chip ${t === filterType ? "active" : ""}" type="button">${t}</button>`);
      chip.addEventListener("click", () => { filterType = t; renderList(); });
      filterBox.appendChild(chip);
    });

    // —— 内置食材（含已覆盖 / 已隐藏状态，可编辑覆盖、隐藏、还原）——
    const overrideById = {};
    for (const c of state.customFoods) if (builtinIdSet().has(c.id)) overrideById[c.id] = c;

    state.foodDb.forEach((f) => {
      if (filterType !== "全部" && foodType(f) !== filterType) return;
      const ov = overrideById[f.id];
      const hidden = isHidden(f.id);
      const name = ov ? ov.name : f.name;
      const shown = ov || f;
      const tags = [];
      if (ov) tags.push('<span class="tag tag-override">已覆盖</span>');
      if (hidden) tags.push('<span class="tag tag-hidden">已隐藏</span>');
      const row = el(`
        <div class="foodlib-item ${hidden ? "is-hidden" : ""}">
          <div class="foodlib-item-info">
            <b>${esc(name)} ${tags.join("")}</b>
            <span class="foodlib-macros">${macroText(shown)} <small>${foodType(f)}</small></span>
          </div>
          <div class="foodlib-item-actions">
            <button class="text-button foodlib-edit" type="button" data-id="${esc(f.id)}">编辑</button>
            ${ov ? `<button class="text-button foodlib-restore" type="button" data-id="${esc(f.id)}">还原</button>` : ""}
            <button class="text-button foodlib-hide" type="button" data-id="${esc(f.id)}">${hidden ? "恢复" : "隐藏"}</button>
          </div>
        </div>`);
      row.querySelector(".foodlib-edit").addEventListener("click", () => openCustomFoodForm(dlg, ov || f));
      if (ov) {
        row.querySelector(".foodlib-restore").addEventListener("click", () => {
          removeCustomFood(f.id);
          renderList();
          toast("已还原「" + f.name + "」为内置原值");
        });
      }
      row.querySelector(".foodlib-hide").addEventListener("click", () => {
        if (hidden) { unhideFood(f.id); toast("已恢复「" + name + "」"); }
        else { hideFood(f.id); toast("已隐藏「" + name + "」"); }
        renderList();
      });
      builtinList.appendChild(row);
    });
    if (!builtinList.children.length) {
      builtinList.appendChild(el('<p class="empty">' + (filterType === "全部" ? "内置食材为空。" : "该类型暂无内置食材。") + '</p>'));
    }

    // —— 自定义食材（纯新增，可编辑 / 删除）——
    let pureCustom = state.customFoods.filter((c) => !builtinIdSet().has(c.id));
    if (filterType !== "全部") pureCustom = pureCustom.filter((f) => foodType(f) === filterType);
    if (!pureCustom.length) {
      customList.appendChild(el('<p class="empty">' + (filterType === "全部" ? "暂无自定义食材，点「＋ 新增食材」录入。" : "该类型暂无自定义食材。") + '</p>'));
    }
    pureCustom.forEach((f) => {
      const row = el(`
        <div class="foodlib-item">
          <div class="foodlib-item-info">
            <b>${esc(f.name)}</b>
            <span class="foodlib-macros">${macroText(f)} <small>${foodType(f)}</small></span>
          </div>
          <div class="foodlib-item-actions">
            <button class="text-button foodlib-edit" type="button" data-id="${esc(f.id)}">编辑</button>
            <button class="text-button foodlib-del" type="button" data-id="${esc(f.id)}">删除</button>
          </div>
        </div>`);
      row.querySelector(".foodlib-edit").addEventListener("click", () => openCustomFoodForm(dlg, f));
      row.querySelector(".foodlib-del").addEventListener("click", () => {
        if (window.confirm("确定删除「" + f.name + "」？已记录的历史餐单不受影响。")) {
          removeCustomFood(f.id);
          renderList();
          toast("已删除「" + f.name + "」");
        }
      });
      customList.appendChild(row);
    });
  }

  renderList();
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

// 风格切换（右上角三选一胶囊）。初始读取 localStorage，点击切换 + 持久化。
const THEME_KEY = "fatloss_theme";
const THEMES = ["organic", "industrial", "editorial"];

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = "organic";
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll("#themeSwitch button[data-theme-value]").forEach((b) => {
    b.classList.toggle("active", b.dataset.themeValue === theme);
  });
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeMetaColor(theme));
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) { /* 隐私模式 / 受限：忽略 */ }
}

function themeMetaColor(theme) {
  return theme === "industrial" ? "#0e0d0c" : theme === "editorial" ? "#faf6ef" : "#f6f1e7";
}

function setupTheme() {
  let stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch (_) {}
  applyTheme(stored);
  const switchEl = $("#themeSwitch");
  if (!switchEl) return;
  switchEl.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-theme-value]");
    if (!btn) return;
    applyTheme(btn.dataset.themeValue);
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
  setupTheme();
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
