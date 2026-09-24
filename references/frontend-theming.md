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
