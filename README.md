# 减脂工作台（VF-fatloss-workbench）

生活化减脂工作台 Skill——把「采集—选方法—算目标—餐单—记录—复盘」做成一个可复用的 WorkBuddy 技能。

## 能力

- 三套谭式减脂方法互斥可选：生活化减脂 / 年前碳水循环 / 增肌减脂并行
- 按方法算每日碳水 / 蛋白 / 脂肪目标
- 生成七日餐单 + 采购清单（食材替换、备餐批做）
- 每日饮食记录 + 每周复盘调整
- 产出可校验、可云端持久化的 FatLossPack 数据包
- 内置可部署前端站点（记录四餐 / 看目标 / 看计划 / 复盘进度）

## 目录结构

- `SKILL.md` — 编排入口（工作流 7 步 + 边界）
- `references/` — 数据契约、健康筛查、三方法、食物表、复盘、交付、云端接入、部署升级协议
- `scripts/` — FatLossPack 校验、计划文档生成、演示服务器、部署升级四件套
- `assets/frontend-template/` — 前端站点模板（纯原生 HTML/CSS/JS，零构建）
- `assets/backend-template/` — Cloudflare Worker + D1 后端模板

## 作者

VanF
