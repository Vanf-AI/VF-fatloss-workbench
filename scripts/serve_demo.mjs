#!/usr/bin/env node
// 减脂工作台本地演示服务器（开发/验证用，非产品部署方式）。
// 用法：node scripts/serve_demo.mjs [port] [dataFile]
//   dataFile 可选：指定要加载的 FatLossPack JSON（默认 frontend-template/fatlosspack.sample.json）。
// 静态服务 assets/frontend-template/，并提供 /api/e/demo（编辑）+ /api/r/demo（只读）。
// 访问 http://localhost:PORT/e/demo 打开工作台；数据保存在内存，重启丢失。

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(__dirname, "..", "assets", "frontend-template");
const dataFileArg = process.argv[3];
const dataPath = dataFileArg
  ? path.resolve(dataFileArg)
  : path.join(FRONTEND, "fatlosspack.sample.json");
const SAMPLE = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

let document = SAMPLE;
let revision = 1;

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

function serveStatic(res, pathname) {
  let filePath = path.join(FRONTEND, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(FRONTEND)) { res.writeHead(403); res.end(); return; }
  if (pathname === "/" || pathname.startsWith("/e/") || pathname.startsWith("/r/")) filePath = path.join(FRONTEND, "index.html");
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    const ext = path.extname(filePath);
    // 演示服务器禁用缓存：模板改动立即生效，避免浏览器拿旧 app.mjs
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const match = url.pathname.match(/^\/api\/([er])\/([^/]+)\/?$/);

  if (match) {
    const mode = match[1] === "e" ? "edit" : "read";
    if (req.method === "GET") {
      json(res, 200, { revision, updatedAt: new Date().toISOString(), document });
      return;
    }
    if (req.method === "PUT" && mode === "edit") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          document = parsed;
          revision += 1;
          json(res, 200, { saved: true, revision });
        } catch (e) {
          json(res, 400, { error: "invalid_json" });
        }
      });
      return;
    }
    if (req.method === "PUT") { json(res, 403, { error: "read_only" }); return; }
    json(res, 405, { error: "method_not_allowed" });
    return;
  }

  if (url.pathname === "/health") { json(res, 200, { ok: true, platform: "local-demo" }); return; }
  serveStatic(res, url.pathname);
});

const port = Number(process.argv[2]) || 4173;
server.listen(port, () => {
  console.log(`减脂工作台 demo 已启动：`);
  console.log(`  编辑入口：http://localhost:${port}/e/demo`);
  console.log(`  只读入口：http://localhost:${port}/r/demo`);
});
