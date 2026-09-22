// FatLoss 工作台 host adapter：前端 ↔ 后端持久化的桥接契约。
// 前端只认 load() / save()，不关心后端是 Cloudflare Worker 还是 WorkBuddy 云库。
// 宿主通过 window.FATLOSS_HOST_ADAPTER 注入 load/save；否则走 HTTP 端点。

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`Host adapter requires ${name}()`);
  return value;
}

function requireVersion(value, operation) {
  if (value === null || value === undefined || value === "") {
    throw new TypeError(`Host adapter ${operation}() must return version or revision`);
  }
  return value;
}

export function createFatLossHostAdapter(options = {}) {
  const mode = options.mode === "read" ? "read" : "edit";
  const loadRecord = requireFunction(options.load, "load");
  const saveRecord = mode === "edit" ? requireFunction(options.save, "save") : options.save;
  return Object.freeze({
    mode,
    async load() {
      const result = await loadRecord();
      if (!result?.document) throw new TypeError("Host adapter load() must return document");
      const version = requireVersion(result.version ?? result.revision, "load");
      return { ...result, version };
    },
    async save(input) {
      if (mode !== "edit") throw Object.assign(new Error("Read-only host adapter cannot save"), { code: "read_only" });
      const result = await saveRecord(input);
      const version = requireVersion(result?.version ?? result?.revision, "save");
      return { ...result, version };
    },
  });
}
