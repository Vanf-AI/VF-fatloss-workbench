#!/usr/bin/env node
import fs from "node:fs";

const filename = process.argv[2];
if (!filename) {
  console.error("Usage: node generate_plan_md.mjs <fatlosspack.json> [out.md]");
  process.exit(2);
}
const pack = JSON.parse(fs.readFileSync(filename, "utf8"));
const out = process.argv[3] || "减脂方案.md";

const methodName = {
  lifestyle: "生活化减脂",
  "carb-cycle": "年前碳水循环",
  recomposition: "增肌减脂并行",
}[pack.method?.id] || pack.method?.id || "未选";

const lines = [];
lines.push(`# 减脂方案`);
lines.push("");
lines.push(`- 方法：${methodName}`);
lines.push(`- 起始日：${pack.profile?.startDate ?? "—"}`);
lines.push(`- 性别：${pack.profile?.gender === "male" ? "男" : "女"}`);
lines.push(`- 体重：${pack.profile?.weight ?? "—"} kg`);
lines.push(`- 每周运动：${pack.profile?.exerciseHours ?? "—"} 小时 / ${pack.profile?.exerciseTimes ?? "—"} 次`);
lines.push("");
lines.push(`## 每日目标`);
if (pack.goal) {
  lines.push(
    `- 碳水 ${pack.goal.carb} g / 蛋白 ${pack.goal.protein} g / 脂肪 ${pack.goal.fat} g / 约 ${pack.goal.kcal} kcal`,
  );
} else {
  lines.push(`- （record-only 模式，无目标）`);
}
lines.push("");

if (pack.method?.id === "carb-cycle" && Array.isArray(pack.method.phases)) {
  lines.push(`## 阶段表`);
  for (const ph of pack.method.phases) {
    lines.push(
      `- ${ph.name}（${ph.startDate} 起 ${ph.days} 天${ph.isHighCarb ? "，高碳日" : ""}）：碳 ${ph.carb} / 蛋 ${ph.protein} / 脂 ${ph.fat} g/kg`,
    );
  }
  lines.push("");
}
if (pack.method?.id === "recomposition" && pack.method.ranges) {
  const r = pack.method.ranges;
  lines.push(`## 起始范围（g/kg）`);
  lines.push(`- 碳水 ${r.carb[0]}–${r.carb[1]} / 蛋白 ${r.protein[0]}–${r.protein[1]} / 脂肪 ${r.fat[0]}–${r.fat[1]}`);
  lines.push("");
}

if (pack.weeklyPlan?.days?.length) {
  lines.push(`## 本周餐单`);
  for (const d of pack.weeklyPlan.days) {
    lines.push(`### D${d.day} ${d.date}（周${d.weekday}）${d.reviewDay ? " · 复盘日" : ""}`);
    for (const meal of d.meals) {
      const items = meal.ingredients
        .map((x) => (x.amount ? `${x.name} ${x.amount}${x.unit}` : x.name))
        .join("、");
      lines.push(`- **${meal.name}**${meal.time ? ` ${meal.time}` : ""}：${items || "—"}`);
    }
    lines.push("");
  }
  if (pack.weeklyPlan.shopping?.length) {
    lines.push(`## 采购清单`);
    for (const s of pack.weeklyPlan.shopping) lines.push(`- [ ] ${s.name} ${s.amount}`);
    lines.push("");
  }
}

lines.push(`## 记录与复盘`);
lines.push(`- 每日记录体重、睡眠、训练、饥饿感（1–5）与偏差；蓝莓 / 蔬菜 / 南瓜籽 / 坚果按口径不计入目标。`);
lines.push(`- 每 7 天复盘：按所选方法口径调整下周碳水，同次不叠加；阶段体重降 ≥3% 才全量重算。`);
lines.push("");

fs.writeFileSync(out, lines.join("\n"), "utf8");
console.log(`已生成 ${out}`);
