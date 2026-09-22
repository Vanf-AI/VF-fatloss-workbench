#!/usr/bin/env node
// 升级后验证：FatLossPack 校验 + 方法/起始日稳定 + 纯代码升级数据不变 + 迁移保留稳定 ID。
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { validateFatLossPack } from "./protocol.mjs";

const [, , beforePath, afterPath, planPath] = process.argv;
if (!beforePath || !afterPath || !planPath) {
  console.error("Usage: node verify_deployment_upgrade.mjs <before-fatlosspack.json> <after-fatlosspack.json> <upgrade-plan.json>");
  process.exit(2);
}

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const before = read(beforePath);
const after = read(afterPath);
const plan = read(planPath);
const errors = validateFatLossPack(after).map((item) => `${item.path}: ${item.message}`);

if (before.method?.id !== after.method?.id) errors.push("method.id: 升级后方法发生变化（禁止跨方法混用）");
if (before.profile?.startDate !== after.profile?.startDate) errors.push("profile.startDate: 升级后起始日发生变化");
if (plan.status === "in-place-code-upgrade" && !isDeepStrictEqual(before, after)) {
  errors.push("fatlosspack: 纯代码升级改变了用户数据");
}

if (plan.status === "data-migration-required") {
  const mealIdsOf = (p) => new Set((p.weeklyPlan?.days || []).flatMap((d) => (d.meals || []).map((m) => m.id)).filter(Boolean));
  const beforeMealIds = mealIdsOf(before);
  const afterMealIds = mealIdsOf(after);
  for (const id of beforeMealIds) if (!afterMealIds.has(id)) errors.push(`weeklyPlan.meals.${id}: 迁移丢失稳定 ID`);
  const favIdsOf = (p) => new Set((p.favoriteMeals || []).map((f) => f.id).filter(Boolean));
  const beforeFavIds = favIdsOf(before);
  const afterFavIds = favIdsOf(after);
  for (const id of beforeFavIds) if (!afterFavIds.has(id)) errors.push(`favoriteMeals.${id}: 迁移丢失稳定 ID`);
}

const result = {
  verified: errors.length === 0,
  planStatus: plan.status,
  methodId: after.method?.id || null,
  startDate: after.profile?.startDate || null,
  checks: ["fatlosspack-valid", "method-id-stable", "start-date-stable", plan.status === "in-place-code-upgrade" ? "data-unchanged" : "stable-ids-preserved"],
  errors,
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
