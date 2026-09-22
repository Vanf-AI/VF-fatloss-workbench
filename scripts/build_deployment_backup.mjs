#!/usr/bin/env node
// 升级前备份：导出 FatLossPack + 版本清单，记录 SHA-256。
// 备份不包含任何 Token / Secret。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateFatLossPack } from "./protocol.mjs";

const [, , fatlossPackPath, manifestPath, outputDirectory] = process.argv;
if (!fatlossPackPath || !manifestPath || !outputDirectory) {
  console.error("Usage: node build_deployment_backup.mjs <fatlosspack.json> <deployment-manifest.json> <output-directory>");
  process.exit(2);
}

const pack = JSON.parse(fs.readFileSync(fatlossPackPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const errors = validateFatLossPack(pack);
if (errors.length) {
  console.error(errors.map((item) => `${item.path}: ${item.message}`).join("\n"));
  process.exit(1);
}
if (manifest.product !== "fatloss-workbench") {
  console.error("Deployment manifest product must be fatloss-workbench");
  process.exit(1);
}

fs.mkdirSync(outputDirectory, { recursive: true });
const writeJson = (name, value) => {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(path.join(outputDirectory, name), text);
  return crypto.createHash("sha256").update(text).digest("hex");
};
const files = {
  "fatlosspack.json": writeJson("fatlosspack.json", pack),
  "deployment-manifest.json": writeJson("deployment-manifest.json", manifest),
};
const metadata = {
  format: "fatloss-workbench-deployment-backup",
  formatVersion: "1.0.0",
  createdAt: new Date().toISOString(),
  methodId: pack.method?.id || null,
  startDate: pack.profile?.startDate || null,
  deploymentId: manifest.deploymentId,
  files,
};
writeJson("backup-metadata.json", metadata);
console.log(JSON.stringify({ backedUp: true, outputDirectory: path.resolve(outputDirectory), ...metadata }, null, 2));
