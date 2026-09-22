// 减脂工作台后端：Cloudflare Worker + D1。
// 单文档表存储一份 FatLossPack JSON；乐观锁 revision 防覆盖；edit/read 双 token 访问控制。
// 部署：前端静态资源 + 本 worker 同域；/api/e/{token} 编辑，/api/r/{token} 只读。

const MAX_DOCUMENT_BYTES = 1024 * 1024;

const MEAL_NAMES = ["早餐", "午餐", "晚餐", "加餐"];
const METHOD_IDS = ["lifestyle", "carb-cycle", "recomposition"];
const SCREENING_MODES = ["pending", "personalized", "record-only"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string";
const isBool = (v) => typeof v === "boolean";

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

async function tokenMatches(candidate, expected) {
  if (!candidate || !expected) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function parseRoute(pathname) {
  const match = pathname.match(/^\/api\/(r|e)\/([^/]+)$/);
  if (!match) return null;
  return { mode: match[1] === "e" ? "edit" : "read", token: decodeURIComponent(match[2]) };
}

async function tokenHash(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function authorize(route, env) {
  const stored = await env.DB.prepare("SELECT token_hash FROM access_tokens WHERE mode = ?").bind(route.mode).first();
  if (stored?.token_hash) return tokenMatches(await tokenHash(route.token), stored.token_hash);
  const bootstrapToken = route.mode === "edit" ? env.EDIT_TOKEN : env.READ_TOKEN;
  return tokenMatches(route.token, bootstrapToken);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function readDocument(env) {
  return env.DB.prepare("SELECT revision, document_json, updated_at FROM fatloss_document WHERE id = 1").first();
}

async function getDocument(env) {
  const row = await readDocument(env);
  if (!row) return json({ error: "document_not_found" }, 404);
  const document = JSON.parse(row.document_json);
  return json({ revision: row.revision, updatedAt: row.updated_at, document }, 200, { etag: `"${row.revision}"` });
}

function isValidFatLossPack(document) {
  if (!isObj(document) || document.protocol !== "fatlosspack" || document.schemaVersion !== "1.0.0") return false;
  const s = document.screening;
  if (!isObj(s)) return false;
  if (!SCREENING_MODES.includes(s.mode)) return false;
  for (const k of ["pregnantOrBreastfeeding", "eatingDisorderRisk", "majorCondition", "concerningSymptoms"]) {
    if (!isBool(s[k])) return false;
  }
  const p = document.profile;
  if (!isObj(p) || !["male", "female"].includes(p.gender) || !isNum(p.weight) || p.weight <= 0) return false;
  if (!isStr(p.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(p.startDate)) return false;
  const m = document.method;
  if (!isObj(m) || !METHOD_IDS.includes(m.id)) return false;
  const recordOnly = s.mode === "record-only";
  const g = document.goal;
  if (!recordOnly && !isObj(g)) return false;
  if (isObj(g)) {
    for (const k of ["carb", "protein", "fat", "kcal"]) if (!isNum(g[k]) || g[k] < 0) return false;
    const expect = g.carb * 4 + g.protein * 4 + g.fat * 9;
    if (Math.abs(g.kcal - expect) > 1) return false;
  }
  if (!isObj(document.fixedIntakes) || !isObj(document.supplements) || !isObj(document.foodLibrary)) return false;
  if (!isObj(document.logs) || !Array.isArray(document.reviews) || !Array.isArray(document.favoriteMeals)) return false;
  const wp = document.weeklyPlan;
  if (wp != null) {
    if (!isObj(wp) || !isBool(wp.confirmed) || !Array.isArray(wp.days)) return false;
    let reviewDays = 0;
    for (const d of wp.days) {
      if (!isObj(d) || !Array.isArray(d.meals)) return false;
      if (d.reviewDay) reviewDays++;
      for (const meal of d.meals) {
        if (!MEAL_NAMES.includes(meal.name)) return false;
        if (!Array.isArray(meal.ingredients)) return false;
      }
    }
    if (wp.days.length > 0 && reviewDays !== 1) return false;
  }
  return true;
}

function parseRevision(value) {
  if (!value) return null;
  const normalized = value.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  const revision = Number(normalized);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

async function putDocument(request, env) {
  const expectedRevision = parseRevision(request.headers.get("if-match"));
  if (!expectedRevision) return json({ error: "if_match_required" }, 428);

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_DOCUMENT_BYTES) return json({ error: "document_too_large" }, 413);

  let document;
  try { document = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }
  if (!isValidFatLossPack(document)) return json({ error: "invalid_fatlosspack" }, 400);

  const nextRevision = expectedRevision + 1;
  const result = await env.DB.prepare(
    `UPDATE fatloss_document SET revision = ?, document_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND revision = ?`,
  ).bind(nextRevision, JSON.stringify(document), expectedRevision).run();

  if (result.meta.changes !== 1) {
    const current = await readDocument(env);
    return json({ error: "revision_conflict", currentRevision: current?.revision ?? null }, 412);
  }
  return json({ saved: true, revision: nextRevision }, 200, { etag: `"${nextRevision}"` });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true, platform: "cloudflare" });
    if (url.pathname === "/api/demo" && request.method === "GET") return getDocument(env);

    const route = parseRoute(url.pathname);
    if (!route || !(await authorize(route, env))) return json({ error: "not_found" }, 404);

    if (request.method === "GET") return getDocument(env);
    if (request.method === "PUT" && route.mode === "edit") return putDocument(request, env);
    if (request.method === "PUT") return json({ error: "read_only" }, 403);
    return json({ error: "method_not_allowed" }, 405, { allow: "GET, PUT" });
  },
};
