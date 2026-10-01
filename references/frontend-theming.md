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
