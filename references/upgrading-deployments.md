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

版本清单只能保存公开版本和部署标识，禁止包含 Token、Cookie、Key、Secret、用户邮箱和数据库凭据。正式发布时把所有 `replace-at-deploy-time` 替换为真实值。

**模板脱敏（回填的必然副作用）**：把站点源码回填进 `assets/frontend-template/` 时，`cp` 会把真实 `endpoint` / `publishableKey`、以及实例专属日期一起带过去。**回填之后必须立刻再脱敏一次**，顺序永远是「回填 → 脱敏 → 自检」，不能只做回填。回填后至少还原这几处：

| 文件 | 还原为 |
|---|---|
| `cloud-init.js` | `endpoint` / `publishableKey` → `"replace-at-deploy-time"` |
| `app.mjs` | `p.startDate || "..."`、`Number(p.targetWeight) || ...` → 与样本包一致的中性值 |
| 其他 | 不得出现真实域名、`wbpk_` / `wbapp_`、实例日期 |

验证用确定性脚本：

```bash
node scripts/check_template_hygiene.mjs [模板目录]   # 默认 ../assets/frontend-template
```

它扫描凭据（`wbpk_` / `wbapp_` / 真实部署域名）、核对 `replace-at-deploy-time` 占位符是否齐备，并比对代码文件里的日期字面量是否都属于模板自带的样本数据（`default-pack.js` / `fatlosspack.sample.json`）——样本之外的日期即视为实例数据泄漏。通过退出 0，发现残留退出 1 并列出文件行号。

> **命令陷阱（踩过两次）**：macOS 自带 BSD grep 的**基本正则不支持 `\|` 作「或」**。`grep "wbpk_\|35037" file` 永远匹配不到任何东西，会给出「无凭据残留」的**假阴性**——曾因此误判模板已脱敏。查多关键字一律用 `grep -E "a|b"`，或分开 grep。

**缓存版本号（踩过的坑，务必逐项核对）**：CDN 按「完整 URL」缓存，裸路径会被钉在首次抓取的那份副本上，因此**每一个**静态资源引用都必须带 `?v=N`。发布新版本时同步递增全部版本号，共 6 个引用点：

| # | 文件 | 引用 |
|---|---|---|
| 1 | `index.html` | `/app.css?v=N` |
| 2 | `index.html` | `/cloud-init.js?v=N` |
| 3 | `cloud-init.js` | `import("./app.mjs?v=N")` |
| 4 | `app.mjs` | `import ... from "./host-adapter.mjs?v=N"` |
| 5 | `app.mjs` | `fetch("/fooddb.json?v=N")` |
| 6 | `build.json` | `{"build":"N"}` —— 版本自愈探针的比对基准 |

第 4 点是真实事故：`host-adapter.mjs` 曾用裸路径 import，CDN 一直返回旧副本（缺字段），当时表现为线上「下一阶段餐单」报错「宿主未接入大模型通道」——而 `app.mjs` / `cloud-init.js` 都是最新的。**只漏一个模块，功能就整条断掉。**（该功能后来已改为本地算法、不再走云端通道，但这条缓存教训对任何模块都成立。）发布后必须用 `curl` 逐条核对：每个 `?v=N` 返回 200，且响应体字节数与本地一致。

**第 6 点（`build.json`）与「用户看到旧版」这个更隐蔽的坑配套**：`?v=N` 只能保证「新页面拉到新资源」，救不了「浏览器根本没去拉新页面」。托管站点不给 `Cache-Control`，浏览器会对 `index.html` **做启发式缓存**（按 `Last-Modified` 推算新鲜期，可达数小时），于是出现：代码已发布、CDN 上 `app.mjs?v=N` 是新版，但用户页面还指着 `app.mjs?v=N-2`，界面上残留着早就删掉的栏目。**v22 → v23 那次发布就踩过**：v23 已删掉复盘卡上的「下一阶段优先食材」，用户页面却还停在 v22 的 HTML（仍引用 `app.mjs?v=22`），于是重新看到了已被删除的栏目。

修法是 `index.html` 末尾那段**版本自愈探针**：加载时探一次 `build.json`（带时间戳 `?t=` 绕开缓存），若线上 `build` 比自己新，就 `location.replace("/?b=<N>")` 换一个 URL 重开——换 URL 等于换缓存键，一定拿到新 HTML。探针只在**页面加载时**跑（不做定时轮询，避免用户填到一半被重载），并用 `sessionStorage` 记一次已跳转，**绝不循环**；探针失败（离线等）静默保持现状。所以：

- `build.json` 的 `build` 数值必须与 `?v=N` 同号，漏改就会出现「明明没更新却一直自动重开」；
- 探针那段脚本**不能被删掉**，删了就等于回到「用户手动强刷」的年代——`check_cache_versions.mjs` 会检查它的存在。
- 注意：探针只能自愈**本版本之后**的缓存。已经困在旧 HTML 里的用户，仍需手动强刷一次（手机上是下拉刷新），之后就会自动跟上。

验证用确定性脚本一次跑完（推荐）：

```bash
node scripts/check_cache_versions.mjs <站点目录> https://<站点域名>
```

它会核对 6 个引用点是否齐全（含 `build.json` 与版本自愈探针）、版本号是否一致、有无裸路径残留，并抓线上逐个比对字节数、确认 `host-adapter.mjs` 里仍有 `llm:` 定义（宿主契约里保留的可选能力，供其他应用复用）。全部通过才退出 0；发现缺失或不一致退出 1 并列出问题。

手工核对的等价命令：

```bash
E="https://<站点域名>"
for p in "app.mjs?v=N" "app.css?v=N" "cloud-init.js?v=N" "host-adapter.mjs?v=N" "fooddb.json?v=N" "build.json"; do
  printf "%-26s" "$p"; curl -s -o /dev/null -w "%{http_code} %{size_download}\n" "$E/$p"
done
curl -s "$E/app.mjs?v=N" | grep -n "host-adapter.mjs"   # 确认 import 已带版本号
curl -s "$E/host-adapter.mjs?v=N" | grep -n "llm:"      # 确认适配器是含 LLM 的新版
```

注意：比对字节数时不要用字符串 `.length`（中文在 UTF-8 下占 3 字节，`String.length` 只数 UTF-16 码元，会得到偏小的假失败）。

裸路径（不带 `?v=`）即使仍返回旧内容也不影响使用，因为新版页面已不再引用它；不要试图用它来判断发布是否成功。

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

   **站点需要登录、拿不到账号时怎么验收界面**：站点由 `cloud-init.js` 在登录成功后才 `import app.mjs`，未登录只看到登录遮罩。绕过办法是在登录闸门之后**自己注入一个 mock 适配器再手动 import `app.mjs`**，即可在**真实文件**上跑完整交互（不要为了验收去改站点代码）：

   **地址优先级：线上域名 > 本地服务。** 站点有稳定 HTTPS 域名时**一律直接对线上验收，不要起本地静态服务** —— 验的就是真正发布出去的那份资源，而且不留后台进程。`check_cache_versions.mjs` 已经逐字节确认「线上 = 本地」，所以线上验收不会漏掉只在本地才有的问题。

   ```bash
   # 站点已发布（常态）：直接开线上地址，零本地进程
   agent-browser open "https://<站点域名>/"
   agent-browser eval "window.FATLOSS_HOST_ADAPTER={mode:'edit',async load(){return{document:window.__FATLOSS_DEFAULT_PACK__,revision:1}},async save(i){window.__SAVED=i.document;return{revision:2}}}; import('/app.mjs?v=N').then(()=>{document.getElementById('loginOverlay')?.remove()}); 'kicked'"
   ```

   只有当**站点还没发布**、或要验证**尚未上线的改动**时，才起本地服务：

   ```bash
   python3 -m http.server 8899 --bind 127.0.0.1     # 验「部署目录」本身，需自己注入 mock 适配器
   node scripts/serve_demo.mjs 8899 <pack.json>     # 验「assets/frontend-template」，自带适配器与样本数据，开 /e/demo
   ```

   **⚠️ 本地服务用完必须停（真实教训）**：起服务只能靠后台任务，而常驻进程不会自己退场。曾有一个 `python3 -m http.server 8899` 空转 **18 小时 49 分**，用户在后台任务面板里看到「后台启动本地静态服务」，误以为平台自作主张起了什么东西，最后手动点垃圾桶停掉。此后按三条来：

   1. **能对线上验收就不起本地服务**（默认如此）；
   2. 一旦起了，**同一轮任务结束前必须停掉**：`lsof -ti:8899 | xargs kill`；
   3. 只要在报告里提到本地服务，就**同时给出停止方式**。

   三个必踩的坑：

   - **登录遮罩会挡住点击**（`z-index:9999`），`agent-browser click` 命中的是遮罩。先 `document.getElementById('loginOverlay')?.remove()`，否则切主题之类的点击全部无效。
   - **多次验收要换 module URL**：同一 URL 的 ES 模块只执行一次，改数据后必须 import 一个新 URL（如 `?v=N&case=x&t=<时间戳>`）才会重新渲染。
   - **视口用 `agent-browser set viewport <w> <h>`**（不是 `agent-browser viewport`，那个会报 Unknown command）；窄屏验收跑 390×844，并检查 `document.documentElement.scrollWidth > innerWidth` 判横向溢出。

   对界面改动，验收至少覆盖：默认数据、空数据（无 logs）、反向数据（体重上升）、缺字段（无 `targetWeight`）、达标边界，以及**真实交互后是否即时刷新**（例如提交新体重后档案头 hero 是否立刻变成新值）。
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
- 替换 `app.mjs`、`app.css`、`cloud-init.js`、`host-adapter.mjs`、`fooddb.json` 等静态资源时，同步递增「缓存版本号」一节的 6 个引用点（含 `build.json`），发布后跑 `scripts/check_cache_versions.mjs` 验证；宿主适配器只按目标版本差异更新。
- 发布前后各读取一次数据库 revision。版本变化时重新生成备份，禁止覆盖用户刚保存的内容。
- 发布后同时验证编辑地址与只读分享地址；只检查公开首页不足以完成升级验收。

## 升级完成回执

回执必须包含：原版本、目标版本、升级类型、原网站地址、数据 schema 是否迁移、备份位置、数据校验结果、浏览器验收结果、保留的域名／访问链接和仍需用户处理的事项。禁止只回复「已更新」。
