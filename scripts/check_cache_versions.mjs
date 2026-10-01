#!/usr/bin/env node
// 缓存版本号自检：确保 6 个静态资源引用点都带 ?v=N（或数字），且版本号完全一致。
//
// 背景（真实事故 1）：CDN 按「完整 URL」缓存。host-adapter.mjs 曾用裸路径 import，
// CDN 一直返回旧副本（没有 llm 字段），线上「下一阶段餐单」于是报
// 「宿主未接入大模型通道」——而 app.mjs / cloud-init.js 都是最新的。只漏一个模块，
// 功能就整条断掉。
//
// 背景（真实事故 2）：托管站点不给 Cache-Control，浏览器会对 index.html 做启发式缓存。
// 用户「代码已发布、页面还是旧版」（复盘卡上残留了已删除的栏目），只能手动强刷。
// 修法是在 index.html 里放一段「版本自愈探针」：加载时探 build.json，线上 build 更新
// 就带 ?b=<N> 重开一次。因此 build.json 也必须是同步点，且探针不能被删掉。
//
// 用法：
//   node check_cache_versions.mjs <站点目录>
//   node check_cache_versions.mjs <站点目录> https://example.com   # 追加线上核对
//
// 退出码：0 = 全部一致；1 = 存在缺失或不一致；2 = 用法/读取错误。

import { readFile } from "node:fs/promises";
import path from "node:path";

// 每个引用点的定位规则：文件 → 用于提取版本号的正则 → 人类可读的位置说明
const REFS = [
  {
    file: "index.html",
    label: "index.html → /app.css",
    re: /\/app\.css\?v=(\d+)/,
    expect: "带 ?v=N",
  },
  {
    file: "index.html",
    label: "index.html → /cloud-init.js",
    re: /\/cloud-init\.js\?v=(\d+)/,
    expect: "带 ?v=N",
  },
  {
    file: "cloud-init.js",
    label: 'cloud-init.js → import("./app.mjs")',
    re: /import\(\s*["']\.\/app\.mjs\?v=(\d+)["']\s*\)/,
    expect: "带 ?v=N",
  },
  {
    file: "app.mjs",
    label: 'app.mjs → import "./host-adapter.mjs"',
    re: /from\s+["']\.\/host-adapter\.mjs\?v=(\d+)["']/,
    expect: "带 ?v=N",
  },
  {
    file: "app.mjs",
    label: 'app.mjs → fetch("/fooddb.json")',
    re: /fetch\(\s*["']\/fooddb\.json\?v=(\d+)["']/,
    expect: "带 ?v=N",
  },
];

// 裸路径引用：出现即说明该资源会被 CDN 钉死在旧副本上
const BARE = [
  { file: "app.mjs", label: 'import "./host-adapter.mjs"（裸路径）', re: /from\s+["']\.\/host-adapter\.mjs["']/ },
  { file: "app.mjs", label: 'fetch("/fooddb.json")（裸路径）', re: /fetch\(\s*["']\/fooddb\.json["']\s*\)/ },
  { file: "cloud-init.js", label: 'import("./app.mjs")（裸路径）', re: /import\(\s*["']\.\/app\.mjs["']\s*\)/ },
];

// 版本自愈探针：index.html 里那段「探 build.json、更新就重开」的脚本。
// 它一旦被误删，用户就又会「看到旧版」且毫无提示，所以必须存在。
const PROBE = { file: "index.html", marker: "fatloss.build.jump" };

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

async function main() {
  const dir = process.argv[2];
  const liveUrl = process.argv[3] || null;
  if (!dir) fail("用法：node check_cache_versions.mjs <站点目录> [线上URL]");

  const sources = new Map();
  for (const f of [...new Set(REFS.map((r) => r.file).concat(BARE.map((b) => b.file)))]) {
    try {
      sources.set(f, await readFile(path.join(dir, f), "utf8"));
    } catch (e) {
      fail(`读取失败：${path.join(dir, f)} — ${e.message}`);
    }
  }

  const problems = [];
  const versions = [];

  console.log(`站点目录：${dir}\n`);
  for (const ref of REFS) {
    const m = sources.get(ref.file).match(ref.re);
    if (!m) {
      problems.push(`${ref.label} 缺少 ${ref.expect}`);
      console.log(`  ✗ ${ref.label}  → 未找到版本号`);
      continue;
    }
    versions.push({ label: ref.label, v: Number(m[1]) });
    console.log(`  ✓ ${ref.label}  → v=${m[1]}`);
  }

  for (const b of BARE) {
    if (b.re.test(sources.get(b.file))) {
      problems.push(`${b.label}：CDN 会命中旧缓存，必须改成 ?v=N`);
      console.log(`  ✗ ${b.label}  → 裸路径，会被 CDN 缓存住`);
    }
  }

  // build.json：版本自愈探针的比对基准，必须与 ?v=N 同号
  let buildVersion = "";
  try {
    const raw = JSON.parse(await readFile(path.join(dir, "build.json"), "utf8"));
    buildVersion = String(raw.build ?? "");
  } catch (e) {
    problems.push(`build.json 读取/解析失败：${e.message}（版本自愈探针依赖它，不能缺）`);
    console.log(`  ✗ build.json  → ${e.message}`);
  }
  if (buildVersion) {
    if (/^\d+$/.test(buildVersion)) {
      versions.push({ label: "build.json → build", v: Number(buildVersion) });
      console.log(`  ✓ build.json  → build=${buildVersion}`);
    } else {
      problems.push(`build.json 的 build 必须是纯数字，当前为 "${buildVersion}"`);
      console.log(`  ✗ build.json  → build 不是纯数字：${buildVersion}`);
    }
  }

  // 探针本身必须还在（被删掉的话，用户会再次「看到旧版」且毫无提示）
  if (!sources.get(PROBE.file).includes(PROBE.marker)) {
    problems.push(`index.html 缺少版本自愈探针（找不到 "${PROBE.marker}"），用户会再次看到旧版页面`);
    console.log(`  ✗ index.html  → 版本自愈探针缺失`);
  } else {
    console.log(`  ✓ index.html  → 版本自愈探针存在`);
  }

  const distinct = [...new Set(versions.map((x) => x.v))];
  if (distinct.length > 1) {
    problems.push(`版本号不一致：${distinct.map((v) => `v=${v}`).join(" / ")}（应全部相同）`);
  } else if (distinct.length === 1) {
    console.log(`\n统一版本号：v=${distinct[0]}`);
  }

  if (liveUrl && problems.length === 0) {
    const base = liveUrl.replace(/\/+$/, "");
    const v = distinct[0];
    console.log(`\n线上核对：${base}`);
    const targets = [
      `app.mjs?v=${v}`,
      `app.css?v=${v}`,
      `cloud-init.js?v=${v}`,
      `host-adapter.mjs?v=${v}`,
      `fooddb.json?v=${v}`,
      "build.json",
    ];
    for (const t of targets) {
      try {
        const res = await fetch(`${base}/${t}`);
        const body = await res.text();
        // 必须比字节数：中文在 UTF-8 下占 3 字节，而 String.length 只数 UTF-16 码元。
        const remoteSize = Buffer.byteLength(body, "utf8");
        const local = path.join(dir, t.split("?")[0]);
        const localSize = Buffer.byteLength(await readFile(local, "utf8"), "utf8");
        const ok = res.ok && remoteSize === localSize;
        if (!ok) problems.push(`线上 ${t}：HTTP ${res.status}，${remoteSize} 字节 ≠ 本地 ${localSize} 字节`);
        console.log(`  ${ok ? "✓" : "✗"} ${t}  → HTTP ${res.status}，${remoteSize} 字节（本地 ${localSize}）`);
      } catch (e) {
        problems.push(`线上 ${t}：请求失败 ${e.message}`);
        console.log(`  ✗ ${t}  → ${e.message}`);
      }
    }
    // 适配器必须真的含 llm 定义，光看字节数不够
    try {
      const adapter = await (await fetch(`${base}/host-adapter.mjs?v=${v}`)).text();
      const hasLlm = /\bllm\s*:/.test(adapter);
      if (!hasLlm) problems.push("线上 host-adapter.mjs 不含 llm 定义（仍是旧版适配器）");
      console.log(`  ${hasLlm ? "✓" : "✗"} host-adapter.mjs 含 llm 定义`);
    } catch (e) {
      problems.push(`线上适配器内容检查失败：${e.message}`);
    }
  }

  if (problems.length) {
    console.error("\n发现问题：");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("\n修复：把全部 6 个引用点（含 build.json）统一改成同一个新版本号，重新发布，再跑一次本脚本（带线上 URL）。");
    process.exit(1);
  }

  console.log("\n全部通过：6 个引用点版本号一致，无裸路径引用，版本自愈探针在位。");
}

main();
