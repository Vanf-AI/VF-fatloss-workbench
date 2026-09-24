# 已部署减脂工作台升级协议

## 适用范围

用户提出「用最新版 Skill 更新网站」「升级已部署工作台」「同步新版功能」或同类请求时进入本流程。内容更新（改餐单、改目标、加记录）继续走「更新现有计划」；产品代码、宿主适配器或数据 schema 更新使用本协议。

Skill 更新不会自动修改线上网站。升级属于一次新的线上发布操作，需要用户明确指定目标网站或宿主项目。优先更新原项目，保留原域名、数据库、权限、访问链接和 Secret。禁止为了省事新建应用并静默替换链接。

## 版本清单

每次正式部署必须在网站根目录发布 `fatloss-app-manifest.json`，内容基于 `assets/deployment-manifest.template.json`，至少包含：

- `product`、`manifestVersion`；
- `skillVersion`、`frontendVersion`、`hostAdapterVersion`；
- `dataSchemaVersion`、`compatibleDataSchemaVersions`、`migrations`；
- `deploymentMode`、`deploymentId`、`siteUrl`、`deployedAt`。

版本清单只能保存公开版本和部署标识，禁止包含 Token、Cookie、Key、Secret、用户邮箱和数据库凭据。正式发布时把所有 `replace-at-deploy-time` 替换为真实值。静态资源使用版本化文件名或查询参数（`?v=N`），防止浏览器继续加载旧缓存。**注意：`app.mjs` 由 `cloud-init.js` 动态 `import("./app.mjs?v=N")` 加载，改代码 / 数据后除 `index.html` 里的 `?v=` 外，还要同步递增 `cloud-init.js` 里 import 的 `?v=`，否则用户仍读到旧 `app.mjs`。**

使用确定性脚本生成正式清单：

```bash
node scripts/build_deployment_manifest.mjs \
  assets/deployment-manifest.template.json deployment-info.json fatloss-app-manifest.json
```

`deployment-info.json` 只包含 `deploymentMode`、`deploymentId`、`siteUrl` 和可选 `deployedAt`。脚本会拒绝 Token、Secret、Cookie、密码、邮箱和 API Key 等敏感字段。

## 升级步骤

1. **定位原项目**：从用户指定网站读取 `fatloss-app-manifest.json`，核对 `deploymentId`、`siteUrl` 和宿主项目。禁止仅凭相似标题猜测项目。
2. **读取线上数据**：通过当前适配器读取最新 FatLossPack 与 revision。升级计划生成后再次读取 revision；期间出现变化时重新备份和计划。
3. **生成升级计划**：运行：

   ```bash
   node scripts/plan_deployment_upgrade.mjs current-manifest.json assets/deployment-manifest.template.json > upgrade-plan.json
   ```

   允许状态：
   - `already-current`：无需发布；
   - `in-place-code-upgrade`：数据 schema 兼容，只更新代码；
   - `data-migration-required`：存在明确迁移脚本，执行复制迁移。

   阻断状态：
   - `legacy-audit-required`：旧站缺少可信清单，先审计与备份；
   - `downgrade-blocked`：目标版本低于线上版本；
   - `incompatible-data-schema`：缺少受控迁移；
   - `invalid-target-manifest` 或 `invalid-version`：版本清单无效。

4. **备份**：导出最新 FatLossPack 和原版本清单：

   ```bash
   node scripts/build_deployment_backup.mjs fatlosspack.json current-manifest.json backup-dir
   ```

   备份保存在用户拥有的项目或用户明确选择的位置。报告路径、时间和 SHA-256；禁止把私密 Token 或 Secret 放入备份。

5. **展示计划**：向用户说明版本差异、代码文件、宿主适配器变化、是否迁移数据、链接是否保持、风险和回滚点。用户已明确要求升级时，可以在计划无新增高风险动作的情况下继续；新增付费、账号、Key、权限扩大、域名变化或不可逆迁移时暂停确认。
6. **执行升级**：
   - 纯代码升级只替换前端资源、公开版本清单和确有变化的宿主适配器；禁止初始化数据库或写入示例 FatLossPack。
   - 数据迁移在副本上运行，迁移结果先通过 FatLossPack 校验。使用线上最新 revision 条件写入；冲突时停止并重新读取。
   - 更新原站点项目和原发布目标。宿主只能新建应用时，先向用户说明域名和链接会变化。
7. **验证数据**：导出升级后的 FatLossPack 并运行：

   ```bash
   node scripts/verify_deployment_upgrade.mjs \
     backup-dir/fatlosspack.json after-fatlosspack.json upgrade-plan.json
   ```

   纯代码升级要求 FatLossPack 完全一致；数据迁移要求 schema 有效、`method.id` 与 `profile.startDate` 不变、`weeklyPlan` 餐次 ID 与 `favoriteMeals` ID 保留。
8. **真实浏览器验收**：检查四区导航（今日/本周/复盘/我的）、目标修复、未登录编辑预检、成功保存、刷新恢复、只读拒写、冲突识别和用户指定分享渠道。浏览器必须确认已加载新版本资源及新版本清单。
9. **完成与回滚点**：验收通过后写入目标版本清单并报告备份位置。验收失败时恢复旧静态资源；数据迁移已经写入时使用备份和原 revision 规则执行受控恢复，禁止覆盖升级期间产生的新用户写入。

## 旧站兼容

缺少版本清单的站点统一标为 `legacy-audit-required`。Agent 需要读取原项目文件、当前 FatLossPack、数据库结构、宿主适配器和线上资源版本，创建备份后生成一份「推定当前版本」报告。只有证据能够确认兼容性时才补写初始版本清单。无法确认数据 schema 或项目归属时停止升级。

## 数据迁移规则

- 每条迁移声明唯一的 `from`、`to` 和 Skill 包内真实存在的相对脚本路径；计划器拒绝绝对路径、目录穿越和缺失脚本。禁止现场生成未测试迁移直接写线上。
- 迁移脚本必须是确定性的纯数据转换，不访问网络，不读取 Secret。
- `method.id` 与 `profile.startDate` 属于计划身份锚点，迁移不得改变；切换方法视为新建计划，不属本协议。
- `weeklyPlan.days[].meals[].id` 与 `favoriteMeals[].id` 属于稳定 ID，迁移必须保留。
- 用户已填 `logs`、`reviews`、`history` 和备注属于受保护内容，默认不重写。
- 每次迁移增加自动化用例，覆盖旧样本、重复执行和失败回滚。

## WorkBuddy 要求

- 优先回到原任务或通过 `deploymentId` 定位原应用，更新同一 Sites 项目。
- 保留原数据库集合（`fatloss_documents`）、RLS 权限规则、登录身份、只读发布副本和正式域名。
- 替换 `app.mjs`、`app.css`、`cloud-host.mjs` 等静态资源时同步更新缓存版本；宿主适配器只按目标版本差异更新。
- 发布前后各读取一次数据库 revision。版本变化时重新生成备份，禁止覆盖用户刚保存的内容。
- 发布后同时验证编辑地址与只读分享地址；只检查公开首页不足以完成升级验收。

## 升级完成回执

回执必须包含：原版本、目标版本、升级类型、原网站地址、数据 schema 是否迁移、备份位置、数据校验结果、浏览器验收结果、保留的域名／访问链接和仍需用户处理的事项。禁止只回复「已更新」。
