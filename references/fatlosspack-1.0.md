# FatLossPack 1.0.0 输出约束

顶层必须包含：

```text
protocol = "fatlosspack"
schemaVersion = "1.0.0"
screening
profile
method
goal
fixedIntakes
supplements
foodLibrary
weeklyPlan
logs
reviews
favoriteMeals
history
```

## 核心字段

- `screening`：`age`（可空）、`pregnantOrBreastfeeding`、`eatingDisorderRisk`、`majorCondition`、`concerningSymptoms`（布尔）、`mode`（限定 `pending` / `personalized` / `record-only`）、`reviewedAt`（可空）。筛查异常时 `mode` 必须非 `personalized`。
- `profile`：`gender`（限定 `male` / `female`）、`weight`（起始体重 kg）、`targetWeight`（可选正数，目标体重 kg，用于减脂进度；缺省则不显示进度百分比）、`exerciseHours`（每周合计）、`exerciseTimes`（每周次数）、`startDate`（`YYYY-MM-DD`）。
- `method`：`id` 限定 `lifestyle` / `carb-cycle` / `recomposition`，与用户确认选择一致；方法专属结构见下。
  - `lifestyle`：无额外必填结构，目标按系数表计算。
  - `carb-cycle`：`phases[]`，每项 `{ index, name, carb, protein, fat, startDate, days, isHighCarb }`；`carb/protein/fat` 为 `g/kg` 系数；需覆盖明确起止日；高碳日 `isHighCarb: true`。
  - `recomposition`：`ranges`（碳/蛋/脂各为 `[min,max]` g/kg）、`startPoint`（初始目标 g/kg，须落在 `ranges` 内）、`stateSignals[]`（观察维度：渴望 / 训练状态 / 睡眠 / 食欲等）。
- `goal`：`carb`、`protein`、`fat`、`kcal`（整数）；`kcal = carb*4 + protein*4 + fat*9`。
  - 复盘支撑字段（可选，由复盘引擎写入）：`reviewDay`（0–6，复盘日，0=周日）、`stageBaselineWeight`（阶段基准体重 kg，用于判定「阶段降 ≥3% 全量重算」）、`adjustLog[]`（调整留痕 `{ at, windowStart, windowEnd, verdict, deltaCarb, stageReset, manual, override, carbAfter }`；同一 `windowEnd` 的**引擎建议**不重复应用，`override: true` 表示用户在该窗口内显式人工覆盖目标）。
- `fixedIntakes`：`proteinPowder`、`milk`（数值）、`note`。
- `supplements`：`blueberries`、`vegetables`、`pumpkinSeeds`、`nuts`（布尔）。声明式的「日常补充」标记，只用于「我的」页展示；**排餐时的实际克数走 `fatFixes`**，两者互不驱动。
- `foodLibrary`：`selected[]`（**已废弃**：早期「下一阶段优先食材」用，现由 `staples` / `proteins` / `fatFixes` 三块按餐次口径取代；新数据不再写入，旧数据残留不校验、报错只在其存在且非数组时）、`hidden[]`（隐藏的内置食材 `id` 数组）、`custom[]`（自定义 / 覆盖条目）。`custom[]` 每项 `{ id, name, carb, protein, fat, unit, per, category, note? }`：`id` 命中内置同 `id`=覆盖该内置，否则纯新增（`custom-*`）；`carb/protein/fat` 为该条目基准量下的宏量克数；`unit` 为 `g` / `ml` / `个`；`per` 为基准量（100=每 100g/ml，1=每 1 个）；`category` 为 6 类之一或内置细分。详见 [food-library.md](food-library.md)。
- `staples`（可选）：`{ breakfast[], lunch[], dinner[] }`，元素为 `fooddb.json` 的食材 `id`。**字段缺失即谭师默认口径**（燕麦只在早餐 / 午餐大米 / 晚餐薯类轮换）；某餐为**空数组 = 该餐不限定主食**。排餐时直接作为主食候选池，详见 [planning.md](planning.md)。
- `proteins`（可选）：结构与 `staples` 完全同构，元素为食材 `id`。**字段缺失即谭师默认口径**（早餐全蛋 / 午餐白肉或虾仁 / 晚餐瘦牛肉）；某餐为**空数组 = 该餐不限定蛋白**。排餐时直接作为蛋白候选池——不按餐次分开，就会轮出「午餐 7 个鸡蛋」这类组合，详见 [planning.md](planning.md)。
- `fatFixes`（可选）：`{ breakfast: { id, amount }, dinner: { id, amount } }`，`amount` 为每日固定克数。**字段缺失即默认**早餐南瓜子 10g / 晚餐混合坚果 15g；`amount` 为 0 或 `id` 为空 = 取消该项。这两项是每天固定的摄入量、不参与轮换，也不作为可调脂肪源；其余脂肪由烹调油在午餐 / 晚餐补足，详见 [planning.md](planning.md)。
- `weeklyPlan`：`confirmed`（布尔）、`weekIndex`、`startDate`、`days[]`、`shopping[]`、`nutritionTotals[]`。
  - `days[]`：每项 `{ day, date, weekday, reviewDay, meals[] }`。
  - `meals[]`：每项 `{ id, name, time, ingredients[] }`；`name` 限定 `早餐` / `午餐` / `晚餐` / `加餐`。
  - `ingredients[]`：每项 `{ name, amount, unit }`。
- `logs`：以天号为键的对象；每天 `{ weight?, sleep?, trainingMin?, trainingFeel?, hunger?, meals? }`。
  - `trainingMin`：训练时长（分钟）；复盘页按它绘制每日训练柱状图。
  - `trainingFeel`：训练感受，限定 `有力` / `一般` / `乏力`；是复盘规则「≥2 次乏力 → 碳水 +10g」的数据源，缺省即视为未记录（不参与判定）。
  - 执行偏差不落库：由前端 `computeDeviations` 遍历 `meals` 的宏量快照求和（`dayIntake`）后与 `goal` 对比自动得出，无需用户手填 `deviation`。
  - `meals`：以餐名（`早餐` / `午餐` / `晚餐` / `加餐`）为键；每餐 `{ items[] }`。
  - `items[]`：每项 `{ id, name, amount, unit, carb, protein, fat }`；`amount` 为摄入数量、`unit` 为单位（`g` / `ml` / `个`），`carb/protein/fat` 为该食材该份数量折算后的宏量（克，快照，保留历史不受食材库更新影响）。该餐合计宏量 = Σ items 的 `carb/protein/fat`。
- `reviews`：每项 `{ day, windowStart, windowEnd, message, nextGoal, confirmed, confirmedAt? }`；`nextGoal` 同 `goal` 结构；`windowStart` / `windowEnd` 为本次核算窗口的起止日期。
- `favoriteMeals`：每项 `{ id, name, mealName, ingredients[] }`；`ingredients[]` 每项 `{ id, name, amount, unit }`，只存食材与份量、**不存宏量快照**——「记入」时按当前食材库实时算碳蛋脂，食材库改动后自动跟随。
- `history`：`weeks[]`（被替换下来的周计划，每项 `{ weekIndex, startDate, archivedAt, goalAtThatTime, days[] }`）、`reviews[]`（复盘摘要）。归档只读、不重算。

## 引用与安全

- 全部 ID 在顶层集合间唯一；`dayId` / `mealId` / `foodId` 等引用必须存在。
- 字段名称属于运行时契约；近义字段不自动兼容（如 `note` 不能代替 `notes`）。
- 周日期覆盖全部 `days`；`reviewDay` 每周恰 1 天（通常为第 7 天）。
- 云端凭据、Cookie、Token、证件号不得进入 FatLossPack 任何字段。
- 健康敏感信息只在 `screening` 内，不进公开字段。
- `screening.mode = "record-only"` 时，`goal` 与 `weeklyPlan` 可为空，仅承载记录。
