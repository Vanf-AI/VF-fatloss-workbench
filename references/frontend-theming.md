# 前端主题（三套可切换风格）

工作台内置三套设计风格，顶栏右上角「有机 / 仪表 / 杂志」一键切换，选择持久化到 `localStorage.fatloss_theme`。

| 主题 | data-theme | 方向 | 字体 | 主色 / 强调 | 氛围 |
|---|---|---|---|---|---|
| 有机（默认） | `organic`（或缺失） | 自然 Organic | Noto Serif SC / Noto Sans SC / IBM Plex Mono | 森林绿 #2f6b4f / 琥珀 #e8893a | 米纸 + 纸质噪点 |
| 仪表 | `industrial` | 工业 Industrial | Inter Tight / JetBrains Mono | 橙 #ff6b2c | 近黑 #0e0d0c + CRT 扫描线 + 方角 |
| 杂志 | `editorial` | 杂志 Editorial | Playfair Display / Source Serif 4 / JetBrains Mono | 金黄 #c98a1f | 暖白 + 规则线 + 斜体衬线 |

## 架构：CSS token 化

所有颜色 / 字体 / 圆角 / 阴影 / 氛围都走 CSS 变量，组件内**零硬编码色值**：

```text
--bg / --bg-soft / --surface / --card-bg / --text / --muted / --hint / --line / --line-strong
--primary / --primary-deep / --primary-soft / --moss / --sage
--accent / --accent-soft / --danger / --danger-soft
--font-display / --font-body / --font-mono
--atmosphere-bg / --grain-image / --grain-opacity / --grain-blend
```

- 默认值写在 `:root, :root[data-theme="organic"]`。
- `:root[data-theme="industrial"]` 与 `:root[data-theme="editorial"]` 覆盖同一套 token。
- 个别需按主题微调的组件（圆角、边框、激活态、字体斜体）用 `:root[data-theme="…"] .selector` 精确覆写，不改组件主结构。
- 图表（SVG 内联）同样用 `var(--primary)` / `var(--accent)` / `var(--line)`，切主题时自动跟随。

## 档案头「当前体重」hero（主视觉）

档案头（`.profile-header`）是四个 tab 共用的常驻区域，也是页面第一眼区域，因此把**当前体重**放这里做主视觉：

```text
YOUR FATLOSS PLAN
当前体重 · 最近记录 09-29          [DAILY 1859 kcal]
75.2 kg
↓ 2.3 kg 较起始  距目标 5.2 kg  起始 77.5 kg
男 · 生活化减脂
起始 2026-08-29 · 每周 4.5 小时 / 5 次
每日目标：碳水 … · 蛋白 … · 脂肪 …
[第 32 / 90 天 · 剩 58 天]  [进度条]
```

**关键数据口径（容易写错）**：`profile.weight` 是**建档起始体重**，不随减重变化；「当前体重」必须取 `logs` 里**日期最大**的一条 `weight`，**没有记录时才回落到起始体重**。早期版本把 `profile.weight` 直接写进标题当「当前体重」，减重后显示的就是错的。统一走 `currentWeightInfo()`：

```js
currentWeightInfo() → { startWeight, value, date, isLogged }
```

- `value` 已含回落逻辑；`isLogged` 区分实测值与起始值，避免把起始体重冒充成当前值。
- `fatlossProgress()` 与「我的 → 档案」都复用同一个 helper，不许各自再遍历一遍 `logs`。
- 提交今日状态后要**主动调一次 `renderProfileHeader()`**：体重变了 hero 必须立刻更新，而提交流程不会触发整页 `render()`。

**标签语义**：`↓ x kg 较起始`（降 = `--primary-soft` 底）/ `↑ x kg`（升 = `--accent-soft` 底）/ `与起始持平` / `距目标 x kg`（仍在目标之上）/ `已达成目标 ✓`（达到或低于目标）。无 `targetWeight` 时不出目标标签。

**三主题表达**：数字走 `var(--font-display)`（有机衬线 / 仪表等宽 / 杂志 Playfair），字号 `clamp(44px, 12vw, 64px)`；标签走 `var(--font-mono)` 小字宽字距。仪表风把标签与 chip 改方角 + 大写，杂志风把标签换成金色斜体衬线。

## 切换机制（app.mjs）

- `setupTheme()`：读 `localStorage.fatloss_theme` → `applyTheme()`；给 `#themeSwitch` 绑定 click 委托。
- `applyTheme(theme)`：设 `document.documentElement.dataset.theme`，更新激活按钮，同步 `<meta name="theme-color">`，写回 localStorage。
- 合法主题集合 `THEMES = ["organic", "industrial", "editorial"]`，非法值回退 `organic`。
- `.theme-switch` 设 `z-index:10000`，高于登录遮罩 `z-index:9999`，登录前也能预览切换。
- `cloud-init.js` 的登录遮罩样式也 token 化（`var(--bg)` / `var(--text)` / `var(--primary)`），登录页随主题变色。

## 加新主题的步骤

1. 在 `app.css` 新增 `:root[data-theme="新名"] { … }` 覆盖全套 token（颜色 + 字体 + 氛围 + 阴影）。
2. 如需组件微调，加 `:root[data-theme="新名"] .selector` 精确覆写。
3. 在 `index.html` 的 `#themeSwitch` 加一个 `data-theme-value="新名"` 按钮。
4. 在 `app.mjs` 的 `THEMES` 数组与 `themeMetaColor()` 加新名。
5. 字体需按需加 Google Fonts `<link>`（`font-display: swap`）。

> 原则：三个方向彼此相反（自然 / 工业 / 编辑），任何新主题也应是一个独立、不混搭的视觉方向，而非现有主题的微调。

## 移动端触摸：阻止「点一下就自动放大页面」

用户报告「手机上点界面就放大」（2026-10-03）。这是**两个互不相干的原因叠加**，只治一个仍会复发，必须同时处理。相关 CSS 统一收在 `app.css` 末尾的「移动端触摸体验」一节。

**① 双击缩放（double-tap zoom）**
手指连续轻点两下（例如连按步进器的 ＋ / −）会被浏览器判成「双击」，整页放大。对策：

```css
html, body { touch-action: manipulation; }
button, a, label, summary, input, select, textarea, [role="button"], .step-btn, .step-value, .cat-chip, .picker-item { touch-action: manipulation; }
```

`manipulation` 只关掉双击缩放并顺带去掉 300ms 点击延迟，**保留平移与双指缩放**，所以不影响滚动，也不牺牲无障碍。

> **坑：`input` 必须显式列出。** `touch-action` **不是继承属性**，只在 `html, body` 上写，`<input>` 自己算出来仍是 `auto`（`<select>` 因为单独列了才是 `manipulation`）。虽然按规范祖先的取值会向下收敛，但显式写上更稳、也便于日后审阅。

**② 输入框聚焦缩放（iOS 的硬性行为）**
iOS Safari 聚焦 `font-size < 16px` 的输入框时会强制把整页放大，否则输入框会被键盘顶到屏幕外。这是浏览器写死的，**16px 是硬门槛，没有别的绕法**。

```css
@media (pointer: coarse) {          /* 只作用于触摸设备，桌面版式不受影响 */
  input:not([type="checkbox"]):not([type="radio"]), select, textarea { font-size: 16px !important; }
  /* 字号抬高后同步放宽小控件，避免文字被挤 */
  .step-value-input, .fe-amount { height: 34px; width: 76px; }
  .picker-grams { width: 88px; }
  .ge-input { padding: 7px 8px; }
  .meal-macros input, .meal-macros select { padding: 10px 11px; }
  .fatfix-amount { width: 92px; padding: 8px 10px; }
}
```

用 `!important` 是必要的：`@media (max-width:860px)` 里有 `.ge-input { font-size: 12px }` 这类按宽度收缩的规则，而 `!important` 跨媒体查询也压得住。

**不要把 `user-scalable=no` 写进 viewport。** 它自 iOS 10 起就被 Safari 忽略（无障碍考虑），加了对 iOS 没用；却在 Android 上**连双指缩放一起禁掉**，属于纯损失。当前 viewport 只保留 `width=device-width, initial-scale=1, viewport-fit=cover`，双指缩放是有意留给用户的。

**验收方法**（Headless Chrome 默认 `pointer: fine`，不模拟触摸就验不到这段）：

```js
await page.emulate({ name: "iPhone 13", userAgent: "<iPhone UA>",
  viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
// 之后必须为 true，否则媒体查询根本没进
matchMedia("(pointer: coarse)").matches
```

逐项断言：`getComputedStyle(input).fontSize === "16px"`、`touchAction === "manipulation"`、以及每个页签 `document.documentElement.scrollWidth <= clientWidth`（抬字号放宽控件后唯一有版式风险的地方）。

## 置顶导航（sticky）与顶栏

置顶的四个模块按钮（今日 / 本周 / 复盘 / 我的）曾同时有两个 bug（2026-10-03 用户报「有一点问题」）：

**① `top` 不能写死。** 导航与顶栏都是 `position: sticky`，导航要贴在顶栏下沿，所以 `top` 必须等于**顶栏的实际高度**。原写法 `top: 67px` 是按桌面量出来的常量，而顶栏高度是变量：手机上品牌文字换行会把顶栏撑到 **100px**，于是导航滑进顶栏底下——顶栏 `z-index: 20` 高于导航 `z-index: 10`，按钮上半截直接被盖住（实测导航中心点命中的是 `HEADER.topbar`）。

对策：把实测高度写进 CSS 变量，导航读变量；并**减 1px** 制造极小重叠，避免亚像素取整留出透明缝。

```css
.module-nav { position: sticky; top: calc(var(--topbar-h, 67px) - 1px); z-index: 10; }
```

```js
// app.mjs：init() 中调用
function syncTopbarHeight() {
  const bar = document.querySelector(".topbar");
  if (!bar) return;
  const apply = () => {
    const h = Math.round(bar.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty("--topbar-h", h + "px");
  };
  apply();
  if (typeof ResizeObserver === "function") new ResizeObserver(apply).observe(bar);
  else window.addEventListener("resize", apply);
  if (document.fonts?.ready) document.fonts.ready.then(apply).catch(() => {});  // 网页字体加载完度量会变
}
```

必须用 `ResizeObserver` 而不是只算一次：顶栏高度随窗口宽度、主题（三套字体度量不同）、网页字体加载而变。兜底值 `67px` 只用于 JS 尚未执行时（此时导航还是 `hidden`，不影响观感）。

**② 导航必须有背景。** `.module-nav` 曾是全透明，滚动时正文从按钮缝隙里透出来（桌面上能看见「1843 kcal」浮在「本周」按钮上）。对策：铺满整行 + 与顶栏同款的毛玻璃，并把限宽下移到内层，让背景铺满而按钮仍与正文对齐：

```css
.module-nav {
  position: sticky; top: calc(var(--topbar-h, 67px) - 1px); z-index: 10;
  padding: 10px 22px;
  background: var(--topbar-bg); backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}
.module-nav-inner { display: flex; max-width: 760px; margin: 0 auto; gap: 6px; }
```

**顶栏挤不下时，先砍品牌文字，别让它换行。** 顶栏一行要装「品牌 + 主题三选一 + 权限徽章 + 两个图标按钮」。390px 下可用宽 358px，而「图标+文字」137px + 操作区 237px = **374px 必然溢出**——后果不只是难看：`.brand-mark` 是 flex 子项，会被挤到 **26px**（logo 变形），顶栏撑到 100px，进而触发 ①。

对策：`@media (max-width: 620px) { .brand-text { display: none; } }`，并把 `.brand-mark` 设为 `flex-shrink: 0`。阈值取 620px 是因为移动端浏览器还会对长文本做「文字自动放大」，把 541~620px 这一段也顶成两行。名称仍在 `<a aria-label="减脂工作台首页">` 与页面标题里，无障碍不受影响。

**验收方法**：跨 8 档宽度（320 / 360 / 390 / 430 / 540 / 541 / 768 / 1280）滚动到导航吸顶后断言——`顶栏底 ≤ 导航顶`（允许 1px 重叠）、每个按钮**顶部 3px** 处 `elementFromPoint` 命中的是该按钮自己（这是最容易被顶栏吃掉的位置）、以及无横向溢出。
