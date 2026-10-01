#!/usr/bin/env node
// 模板卫生检查：确保 assets/frontend-template 里没有部署实例的凭据与专属数据。
//
// 为什么需要它：回填流程是「把站点源码 cp 到模板」，这一步必然把真实 endpoint /
// publishableKey / 实例日期一起带过去。每轮都必须再脱敏一次，漏一次就把交付给
// 客户的 Skill 包污染了。这个脚本把「脱敏」从靠记性变成靠命令。
//
// 三重检查：
//   1) 致命：真实凭据（wbpk_ / wbapp_）与真实部署域名
//   2) 致命：cloud-init.js 缺少 replace-at-deploy-time 占位符
//   3) 致命：代码文件里出现「样本包 startDate 之外」的日期字面量（= 实例数据泄漏）
// 注释行里的日期（格式示例）不算问题。
//
// 用法：node check_template_hygiene.mjs [模板目录]
// 默认 ../assets/frontend-template；发现问题非零退出。

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || path.join(here, "..", "assets", "frontend-template");

const CREDENTIALS = [
  [/wbpk_[A-Za-z0-9_]{8,}/, "真实 publishableKey"],
  [/wbapp_[A-Za-z0-9]{8,}/, "真实 appId"],
  [/\b[a-z0-9-]+-\d{4,}\.app\.workbuddy\.host/i, "真实部署域名"],
];
const REQUIRED = [
  ["cloud-init.js", /endpoint:\s*"replace-at-deploy-time"/, "endpoint 占位符"],
  ["cloud-init.js", /publishableKey:\s*"replace-at-deploy-time"/, "publishableKey 占位符"],
];

// 合法日期字面量 = 今天 + 模板自带的两份样本数据（default-pack.js / fatlosspack.sample.json）。
// 这两份文件本身就是中性样本，不纳入扫描；代码文件里出现「样本之外」的日期才算实例泄漏。
const allowedDates = new Set([new Date().toISOString().slice(0, 10)]);
const SAMPLE_FILES = new Set(["default-pack.js", "fatlosspack.sample.json"]);
for (const name of SAMPLE_FILES) {
  const p = path.join(dir, name);
  if (!existsSync(p)) continue;
  for (const m of readFileSync(p, "utf8").matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)) allowedDates.add(m[1]);
}

const DATE_RE = /\b(20\d{2}-\d{2}-\d{2})\b/g;
const COMMENT_RE = /^\s*(\/\/|#|\*|\/\*|<!--)/;
const CODE_EXT = new Set([".js", ".mjs", ".html", ".htm", ".css"]);

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const f = path.join(d, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });

const problems = [];
let scanned = 0;

for (const file of walk(dir)) {
  const ext = path.extname(file);
  if (![".js", ".mjs", ".html", ".css", ".json", ".md", ".txt"].includes(ext)) continue;
  scanned++;
  const rel = path.relative(dir, file);
  const lines = readFileSync(file, "utf8").split("\n");

  lines.forEach((line, i) => {
    for (const [re, label] of CREDENTIALS) {
      const m = line.match(re);
      if (m) problems.push(`${rel}:${i + 1}  发现${label}：${m[0]}`);
    }
    if (CODE_EXT.has(ext) && !SAMPLE_FILES.has(path.basename(file)) && !COMMENT_RE.test(line)) {
      for (const m of line.matchAll(DATE_RE)) {
        if (!allowedDates.has(m[1])) {
          problems.push(`${rel}:${i + 1}  日期字面量 ${m[1]} 不属于样本包（疑似实例数据泄漏）`);
        }
      }
    }
  });
}

for (const [file, re, label] of REQUIRED) {
  const p = path.join(dir, file);
  if (!existsSync(p)) { problems.push(`缺少文件 ${file}`); continue; }
  if (!re.test(readFileSync(p, "utf8"))) problems.push(`${file} 缺少${label}`);
}

console.log(`模板卫生检查：${dir}`);
console.log(`  扫描 ${scanned} 个文本文件；允许的日期字面量：${[...allowedDates].join(", ")}`);
if (problems.length) {
  console.log("\n✗ 发现问题：");
  const seen = new Set();
  for (const p of problems) {
    if (seen.has(p)) continue;
    seen.add(p);
    console.log("  - " + p);
  }
  console.log("\n请把残留值换回 replace-at-deploy-time / 样本包中性值后重跑。");
  process.exit(1);
}
console.log("  ✓ 无凭据残留、无实例数据、占位符齐备");
