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
- `fixedIntakes`：`proteinPowder`、`milk`（数值）、`note`。
- `supplements`：`blueberries`、`vegetables`、`pumpkinSeeds`、`nuts`（布尔）。
- `foodLibrary`：`selected[]`、`hidden[]`、`custom[]`（每项 `{ name, category, carb, protein, fat, packageGrams, packageUnit }`）。
- `weeklyPlan`：`confirmed`（布尔）、`weekIndex`、`startDate`、`days[]`、`shopping[]`、`nutritionTotals[]`。
  - `days[]`：每项 `{ day, date, weekday, reviewDay, meals[] }`。
  - `meals[]`：每项 `{ id, name, time, ingredients[] }`；`name` 限定 `早餐` / `午餐` / `晚餐` / `加餐`。
  - `ingredients[]`：每项 `{ name, amount, unit }`。
- `logs`：以天号为键的对象；每天 `{ weight?, sleep?, training?, hunger?, deviation?, meals? }`。
  - `meals`：以餐名（`早餐` / `午餐` / `晚餐` / `加餐`）为键；每餐 `{ items[] }`。
  - `items[]`：每项 `{ id, name, amount, unit, carb, protein, fat }`；`amount` 为摄入数量、`unit` 为单位（`g` / `ml` / `个`），`carb/protein/fat` 为该食材该份数量折算后的宏量（克，快照，保留历史不受食材库更新影响）。该餐合计宏量 = Σ items 的 `carb/protein/fat`。
- `reviews`：每项 `{ day, message, nextGoal, confirmed }`；`nextGoal` 同 `goal` 结构。
- `favoriteMeals`：每项 `{ id, name, mealName, ingredients[] }`。
- `history`：`weeks[]`、`reviews[]`（归档已完成周，只读不重算）。

## 引用与安全

- 全部 ID 在顶层集合间唯一；`dayId` / `mealId` / `foodId` 等引用必须存在。
- 字段名称属于运行时契约；近义字段不自动兼容（如 `note` 不能代替 `notes`）。
- 周日期覆盖全部 `days`；`reviewDay` 每周恰 1 天（通常为第 7 天）。
- 云端凭据、Cookie、Token、证件号不得进入 FatLossPack 任何字段。
- 健康敏感信息只在 `screening` 内，不进公开字段。
- `screening.mode = "record-only"` 时，`goal` 与 `weeklyPlan` 可为空，仅承载记录。
