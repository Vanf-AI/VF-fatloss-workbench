#!/usr/bin/env node
// 生成不含凭据的公开版本清单 fatloss-app-manifest.json。
// 拒绝 Token / Secret / Cookie / 密码 / 邮箱 / API Key 等敏感字段。
import fs from "node:fs";
import path from "node:path";

const [, , templatePath, deploymentInfoPath, outputPath] = process.argv;
if (!templatePath || !deploymentInfoPath || !outputPath) {
  console.error("Usage: node build_deployment_manifest.mjs <template.json> <deployment-info.json> <output.json>");
  process.exit(2);
}

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const template = read(templatePath);
const info = read(deploymentInfoPath);
const sensitiveKey = /(token|secret|cookie|credential|password|email|api[-_]?key)/i;

function assertPublic(value, trail = []) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey.test(key)) throw new Error(`公开版本清单禁止包含敏感字段：${[...trail, key].join(".")}`);
    assertPublic(child, [...trail, key]);
  }
}

assertPublic(info);
for (const key of ["deploymentMode", "deploymentId", "siteUrl"]) {
  if (typeof info[key] !== "string" || !info[key].trim()) throw new Error(`deployment-info 缺少 ${key}`);
}
const url = new URL(info.siteUrl);
if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("正式 siteUrl 必须使用 HTTPS");
if (template.product !== "fatloss-workbench") throw new Error("版本清单模板无效");

const manifest = {
  ...template,
  deploymentMode: info.deploymentMode,
  deploymentId: info.deploymentId,
  siteUrl: info.siteUrl.replace(/\/$/, ""),
  deployedAt: info.deployedAt || new Date().toISOString(),
};
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ created: true, outputPath: path.resolve(outputPath), manifest }, null, 2));
