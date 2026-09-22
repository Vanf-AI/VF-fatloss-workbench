# 云端存储接入

本文件定义 FatLossPack 的持久化与分享，**纪律照搬 hks-travel-skill**：能力发现 → 选模式 → 授权闸门 → 持久化 + 只读分享 + 冲突识别 → 缺口即停。

减脂工作台**已内置前端站点**（`assets/frontend-template/`），因此有两种可部署形态：

1. **standard-cloud（Cloudflare）**：前端模板 + `assets/backend-template/worker.js`（D1 单文档表 + `/api/e/{token}` 编辑 + `/api/r/{token}` 只读）。独立部署，拿到真实可访问 URL。
2. **host-native（WorkBuddy Cloud Service）**：复用 WorkBuddy 原生云库，前端通过 `window.FATLOSS_HOST_ADAPTER` 注入 `load` / `save` 桥接，不依赖自有 Worker。

两种形态共用同一前端（`host-adapter.mjs` 抽象了 load/save 契约），只换持久化后端。

## 能力发现

先检查当前 Agent 宿主已提供的云能力，只做只读查询或最小无副作用探针。能力以"产品结果"描述，不预设具体存储技术：

```json
{
  "id": "workbuddy-cloud",
  "kind": "host-native",
  "free": true,
  "billingRequired": false,
  "userSetup": "confirm",
  "capabilities": {
    "database": true,
    "ownerEdit": true,
    "readOnlyShare": true,
    "accessControl": true,
    "conflictProtection": true,
    "objectStorage": false
  }
}
```

`kind` 依次用 `host-native`、`connected-mcp`、`user-cloud`；`userSetup` 用 `none`、`confirm`、`login`、`api-key`。

判定**四项产品结果**是否齐备：① 可编辑 ② 可持久化 ③ 可只读分享 ④ 可识别冲突。四者齐备才进入 host-native 持久化；缺任一项即转本地 JSON 兜底（见 [deliverables.md](deliverables.md) 第 3 节）并报告缺口。

## 可执行模板（本机实测，2026-09-22）

### 工具名

内置 deferred 工具 `workbuddy_cloud_service`（先用 ToolSearch 加载 schema，再 DeferExecuteTool 调用）。只做环境生命周期（inspect / activate）；SDK 接线看内置 `cloud-service` skill（`~/.workbuddy/plugins/cache/workbuddy-builtin/skill-cloud-service/`）。

### 第一探针：inspect

```text
workbuddy_cloud_service(action: "inspect", directory: "<当前工作区绝对路径>")
```

空会话返回 `{ activated:false, count:0, applications:[] }`；已有应用返回 `applications[]`（含 `applicationId`，形如 `wbapp_...`）。

### 激活：activate（创建新应用）

```text
workbuddy_cloud_service(
  action: "activate",
  directory: "<工作区绝对路径>",
  applicationMode: "create",
  appName: "减脂工作台",           # <=10 字中文，由你概括
  domainPrefix: "fatloss-workbench", # 小写 ASCII，<=32 字符，建后不可改
  intent: "记录饮食和减脂进度"      # 用户表面用词，<=20 字，仅用于确认框标题
)
```

**激活确认由平台 UI 弹出，不得自己问用户要不要开通**（不传 `confirmed`/`confirm`/`skipConfirm`/`force`）。复用已有应用用 `applicationMode:"reuse"` + `applicationId`（幂等，不重复计费）。成功返回：

```json
{
  "activated": true,
  "applicationId": "wbapp_...",
  "billingStatus": "normal",
  "provisionStatus": "assigned",
  "publicConfig": {
    "resourceId": "wbcs_...",
    "endpoint": "https://<domainPrefix>-<x>.app.workbuddy.host",
    "publishableKey": "wbpk_...",
    "oauthRelayBaseUrl": "https://www.workbuddy.cn/v2/as/genie-baas/oauth"
  }
}
```

### 接线（激活后）

- 纯 HTML 无构建 → 用 CDN `<script>`（`@tencent-ai/workbuddy-cloud-sdk@dev`），`WorkBuddyCloud.createWorkBuddyCloud({ endpoint, publishableKey })`；`endpoint` 必传且只能来自 `publicConfig`，不得硬编码或从 `location`/环境变量取。
- **CDN 域名**：skill 内置 `cloud-service` 文档默认写 jsdelivr，但 jsdelivr 在部分网络（实测中国网络）不可达；本 skill 用 **unpkg** 兜底：`https://unpkg.com/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js`。
- 读 `references/database/code-generation.md` 接数据库模块。数据表 `fatloss_documents`（`id` 自增 PK + `owner_id TEXT DEFAULT auth.uid()` + `doc JSONB` + `revision INTEGER` + `updated_at TIMESTAMPTZ`），RLS 四策略：`fd_read_all`（SELECT，`USING true`，公开读=只读分享）、`fd_insert_own` / `fd_update_own` / `fd_delete_own`（`owner_id = auth.uid()`）。
- 前端通过 `window.FATLOSS_HOST_ADAPTER` 注入 `load`/`save`（`load` 取 owner 行、无行回退内置默认包 revision 0；`save` 有行乐观锁 update、无行 insert）。
- **登录闸门**：数据库按 `owner_id` 隔离、无匿名登录，编辑前必须登录；单人工具用「邮箱+密码」登录（注册走 `sendOtp`→`verifyOtp` 带 `password`）。
- 发布站点用 `workbuddy_sites_deploy`，并**复用**该 `applicationId` 作 `appId`（保持域与 Origin 一致，否则云登录失效）。
- 载体顺序不变：Cloudflare → WorkBuddy Cloud Service → 本地 JSON。

本机实测（2026-09-22）：工具名 `workbuddy_cloud_service`，`inspect` 空会话 → `activated:false`；`activate` 成功返回 `appId wbapp_...`、`endpoint https://<domainPrefix>-<x>.app.workbuddy.host`、`billingStatus:normal / provisionStatus:assigned`。随后完成建表 + RLS、前端接 SDK + 登录 + host adapter、发布站点（shareLink 同 endpoint 根路径），Chrome headless 验证未登录态正确渲染登录视图。**结论：减脂工作台已以 host-native（WorkBuddy Cloud Service）上线，不再默认降级 Cloudflare / 本地 JSON；登录后数据读写需用户实测（auth 仅线上 HTTPS 域可用）。**

### 可用载体（按匹配度）

| 载体 | 何时用 | 调用方式 | 满足项 |
|---|---|---|---|
| **Cloudflare standard-cloud** | 默认主版（独立部署、拿到真实 URL） | 部署 `assets/frontend-template/` + `assets/backend-template/worker.js`，D1 建表 `schema.sql` | 可编辑 + 可持久化 + 可只读分享 + 可识别冲突（revision 乐观锁） |
| **WorkBuddy Cloud Service** | 第二宿主（原生机制） | 先 `workbuddy_cloud_service(action:"activate")`（确认框由平台 UI 弹，**不得自己问用户要不要开通**），再按 `cloud-service` skill 的 SDK 文档接线，注入 `window.FATLOSS_HOST_ADAPTER` | 可编辑 + 可持久化 + 可识别冲突；只读分享按平台能力 |
| 本地 `FatLossPack.json` | 云端四项不全 / 用户要求本地 / 授权被拒 | 见 [deliverables.md](deliverables.md) | 可持久化（仅本机） |

选择顺序：**Cloudflare → WorkBuddy Cloud Service → 本地 JSON**。前三者都不成时按停止条件处理并报告缺口。

## 数据归属

每位用户拥有独立云项目 / 数据域。FatLossPack、访问 Token、数据库记录归当前用户的宿主项目；开发者测试项目只承载演示数据。Token / Key / Secret / Cookie 不得写入 FatLossPack、日志、仓库或导出文件。

## 持久化模型（host-native 结果）

宿主原生模式复用 WorkBuddy Cloud Service 提供的云端数据库、用户身份、项目权限与只读分享能力。最低持久化模型：

- 记录 `fatloss_document`：当前 `revision` + 完整 FatLossPack JSON + `updatedAt`。
- 读写边界：编辑入口只有所有者或明确授权者可写；只读分享入口无写权限。

保存语义：

- `save()` 必须带 `expectedVersion`；发现旧版本时抛 `revision_conflict`，保留用户输入并提示冲突，**停止覆盖**。
- 刷新 / 更换设备后可读取最后一次成功保存的数据。

## 授权闸门

平台要求激活数据库或云服务时，触发平台官方确认框。只请求完成本次持久化所需的最小模块（数据库 + 只读分享）；对象存储按实际需要选用。用户取消授权时停止云端交付，转本地 JSON 兜底。

## 分享

- 回传两个入口：可编辑链接（owner）+ 只读分享链接（read-only）。
- 只读分享端对源数据无写权限；分享内容以最近一次成功保存为准。

## 停止条件

- 候选无法同时提供"持久化编辑 + 访问控制下只读分享 + 冲突识别"三项时，停止正式云端交付并报告缺口，转本地 JSON。
- 任何候选需要开通付费、绑定支付或超出免费额度时，先取得用户确认。
- 用户数据隔离或只读拒写无法保证时，该宿主不能承载正式产品。

## 与 hks-travel-skill 的差异

hks 部署完整前端站点（standard-cloud / host-native / single-owner-published-share 三模式 + `window.TRAVEL_HOST_ADAPTER` + `/api/e/{token}` 路由）。减脂工作台**同样部署完整前端站点**，但裁剪了 hks 的以下部分（减脂场景用不到）：

- **无地图 / 附件 / 地点搜索**：删掉 leaflet、`map-adapter.mjs`、附件上传、地点搜索路由。
- **无多风格外观**：单一绿色主题，不做六风格切换。
- **token 轮换**：保留 edit/read 双 token 机制，但前端不暴露「轮换链接」UI（可后续补）。

其余纪律（单文档表 + revision 乐观锁 + host-adapter 抽象 + 能力发现降级）与 hks 一致。
