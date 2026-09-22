# 交付与云端路由

FatLossPack 是单一事实源。校验通过后，先按 [云端存储接入](cloud-storage.md) 做能力发现，再按下列优先级持久化。

## 1. 能力发现（必做）
按 cloud-storage.md 检查当前宿主云能力。四项产品结果（可编辑 / 可持久化 / 可只读分享 / 可识别冲突）齐备 → 走云端；否则 → 本地 JSON 兜底。

## 2. 云端为主（部署可访问站点）
满足能力时，按 cloud-storage.md 的载体顺序部署：

**A. Cloudflare standard-cloud（默认）**
1. 部署 `assets/frontend-template/`（静态站点）到 Pages/Workers。
2. 部署 `assets/backend-template/worker.js` 为 Worker，绑定 D1；执行 `schema.sql` 建表。
3. 设置 `EDIT_TOKEN` / `READ_TOKEN` 环境变量。
4. 回传编辑链接 `/e/{token}` + 只读链接 `/r/{token}`。

**B. WorkBuddy Cloud Service**
1. `workbuddy_cloud_service(action:"activate")`（确认框由平台 UI 弹，不自己问）。
2. 前端注入 `window.FATLOSS_HOST_ADAPTER`（load/save 走 Cloud Service SDK）。
3. 回传站点可访问链接。

两种形态保存都带 `expectedVersion`；旧版本抛 `revision_conflict`、停止覆盖。云端凭据只经宿主身份 / 权限 / Secret / 环境变量注入，禁止写入 FatLossPack。

## 3. 本地 JSON 兜底
云端不可用 / 用户要求时，写入本地 `FatLossPack.json`：
- 与云端使用同一份结构与 `revision`。
- 不自动覆盖用户已填记录、历史周与备注；覆盖前明确提示。

## 4. 人类可读副本（可选，非默认）
需要给人看的文档时运行：
```bash
node scripts/generate_plan_md.mjs <fatlosspack.json>
```
输出 `减脂方案.md`（档案、每日目标、周餐单、记录说明、复盘规则）。默认不生成 csv / 独立 html；如需打印 / 分享视图，再单独导出。

## 不做什么
- 不把云端 Key / Secret 写进任何交付文件。
- 每位用户数据隔离，不跨用户合并。
- 前端站点只做「看目标 + 记饮食 + 复盘」，不做冰箱库存、社交、支付、训练处方、教练聊天。
