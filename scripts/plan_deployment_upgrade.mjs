#!/usr/bin/env node
// 对比线上版本清单与目标模板，输出升级分类。
// 允许：already-current / in-place-code-upgrade / data-migration-required
// 阻断：legacy-audit-required / downgrade-blocked / incompatible-data-schema / invalid-*
import fs from "node:fs";
import path from "node:path";

const [, , currentPath, targetPath] = process.argv;
if (!currentPath || !targetPath) {
  console.error("Usage: node plan_deployment_upgrade.mjs <current-manifest.json> <target-manifest.json>");
  process.exit(2);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`Cannot read manifest ${file}: ${error.message}`);
    process.exit(2);
  }
}

function versionParts(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function migrationFor(target, from, to) {
  const migration = (target.migrations || []).find((item) => item.from === from && item.to === to && item.script);
  if (!migration || path.isAbsolute(migration.script)) return null;
  const root = path.dirname(path.resolve(targetPath));
  const resolved = path.resolve(root, migration.script);
  if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved)) return null;
  return migration;
}

const current = readJson(currentPath);
const target = readJson(targetPath);
const supportedProducts = new Set(["fatloss-workbench"]);
const common = {
  deployment: {
    mode: current.deploymentMode || null,
    id: current.deploymentId || null,
    siteUrl: current.siteUrl || null,
  },
  current: {
    skillVersion: current.skillVersion || null,
    frontendVersion: current.frontendVersion || null,
    hostAdapterVersion: current.hostAdapterVersion || null,
    dataSchemaVersion: current.dataSchemaVersion || null,
  },
  target: {
    skillVersion: target.skillVersion || null,
    frontendVersion: target.frontendVersion || null,
    hostAdapterVersion: target.hostAdapterVersion || null,
    dataSchemaVersion: target.dataSchemaVersion || null,
  },
  preserve: ["fatlosspack", "access-links", "site-url", "deployment-id", "host-secrets"],
};

let result;
if (!supportedProducts.has(current.product) || !current.skillVersion || !current.dataSchemaVersion) {
  result = {
    ...common,
    status: "legacy-audit-required",
    allowed: false,
    reason: "当前部署缺少可信版本清单；先备份数据并审计原项目，禁止直接覆盖。",
  };
} else if (target.product !== "fatloss-workbench" || !target.skillVersion || !target.dataSchemaVersion) {
  result = { ...common, status: "invalid-target-manifest", allowed: false, reason: "目标版本清单无效。" };
} else if (compareVersions(current.skillVersion, target.skillVersion) === null) {
  result = { ...common, status: "invalid-version", allowed: false, reason: "Skill 版本必须使用 x.y.z。" };
} else if (compareVersions(current.skillVersion, target.skillVersion) > 0) {
  result = { ...common, status: "downgrade-blocked", allowed: false, reason: "目标 Skill 版本低于线上版本，默认禁止降级。" };
} else if (
  compareVersions(current.skillVersion, target.skillVersion) === 0
  && current.frontendVersion === target.frontendVersion
  && current.hostAdapterVersion === target.hostAdapterVersion
  && current.dataSchemaVersion === target.dataSchemaVersion
) {
  result = { ...common, status: "already-current", allowed: true, requiresMigration: false, steps: [] };
} else if ((target.compatibleDataSchemaVersions || []).includes(current.dataSchemaVersion)) {
  result = {
    ...common,
    status: "in-place-code-upgrade",
    allowed: true,
    requiresMigration: false,
    steps: ["backup", "deploy-static-assets-to-existing-project", "update-host-adapter-if-needed", "publish", "verify", "write-target-manifest"],
  };
} else {
  const migration = migrationFor(target, current.dataSchemaVersion, target.dataSchemaVersion);
  result = migration ? {
    ...common,
    status: "data-migration-required",
    allowed: true,
    requiresMigration: true,
    migration,
    steps: ["backup", "copy-on-write-migration", "validate-migrated-fatlosspack", "deploy-to-existing-project", "publish", "verify", "write-target-manifest"],
  } : {
    ...common,
    status: "incompatible-data-schema",
    allowed: false,
    requiresMigration: true,
    reason: `缺少 ${current.dataSchemaVersion} → ${target.dataSchemaVersion} 的受控迁移。`,
  };
}

console.log(JSON.stringify(result, null, 2));
if (!result.allowed) process.exitCode = 3;
