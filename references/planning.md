# 下一阶段餐单生成契约

复盘只产出目标数字（`nextGoal`）。要把数字变成可执行的 7 天餐单，由工作台「下一阶段餐单」卡调用**云端大模型**生成。

## 为什么由模型生成，而不是纯前端算法

「7 天不重样、贴合食材库、份量落在合理区间」这类组合问题，纯模板排餐会明显重复。这里让模型做组合，但用**严格结构校验**兜底——校验不通过就不允许落库。

## 调用通道

前端 `callLlm()` → 宿主 adapter 的 `llm()` → `cloud.llm.chat.completions.create`（免密钥，SDK 由云端托管）。

关键约束：

- 每次调用**必须**以 `system` 消息开头，否则接口报错（SDK 不代插）。
- 用 `stream: true` 收集完整文本；`onDelta` 回调用作进度显示。
- 模型从 `cloud.llm.models.list()` 中选第一个 `disabled !== true` 的；**列表为空是合法结果**，不得回退到硬编码模型 id。
- 宿主未注入 `llm()` 时，`callLlm()` 抛 `no_llm`，由界面给出降级提示。

## 提示词结构

`buildPlanningPrompt()` 拼装六段中文纯文本：

| 段落 | 内容 |
| --- | --- |
| 目标 | 每日碳水 / 蛋白 / 脂肪克数 + 约算 kcal（取 `nextGoal`，无则取当前 `goal`） |
| 优选食材 | `foodLibrary.selected` 命中的食材，附类型与每基准量宏量 |
| 完整食材库 | 全部生效食材（内置 − hidden + custom），名称必须完全一致 |
| 日期骨架 | 从今天起 7 天的 `day / date / weekday / reviewDay`，由前端算好并要求原样照抄 |
| 餐次 | 固定三餐：早餐 08:00、午餐 12:30、晚餐 18:30 |
| 输出格式 | 一行 JSON 结构示例 |

食材行格式：`- 名称（类型）每<基准>：碳 Xg 蛋 Yg 脂 Zg`，基准由 `perLabel()` 决定（`per=100` → `100g` / `100ml`，`per=1` → `个`）。**不要自己拼单位字符串**，否则「每 ml」「每 个」这类表述会误导模型算错份量。

日期骨架必须由前端生成后交给模型照抄：模型的日历推算不可靠，而校验要求「7 天中恰有 1 个 `reviewDay`」。

## 输出结构

严格 JSON，无围栏、无解释文字：

```json
{"days":[
  {"day":1,"date":"YYYY-MM-DD","weekday":"三","reviewDay":false,
   "meals":[
     {"id":"m1","name":"早餐","time":"08:00",
      "ingredients":[{"name":"燕麦片","amount":60,"unit":"g"}]}
   ]}
]}
```

## 校验规则（`validateGeneratedPlan`）

任一条不通过即抛错，**不落库**：

1. `days` 为非空数组；
2. 每天必须有 `date` 与非空 `meals`；
3. 餐次 `name` ∈ `早餐` / `午餐` / `晚餐` / `加餐`；
4. 每餐 `ingredients` 非空，每项有 `name`，`amount` 为正数（缺 `unit` 时补 `g`）；
5. `days.length === 7` 时，`reviewDay` 必须恰为 1 天。

解析用 `parsePlanJson()` 容错：先剥离 ``` 围栏，再取首个 `{` 到末个 `}`，兼容模型输出前后带解释文字的情况。

## 失败与降级

| 错误码 | 含义 | 界面表现 |
| --- | --- | --- |
| `no_cloud` | 本地模式，无云端能力 | 提示「当前为本地模式，云端大模型不可用」 |
| `no_llm` | 宿主未注入 `llm()` | 提示「宿主未接入大模型通道」 |
| `no_model` | 模型列表为空 | 提示稍后再试 |
| 校验 / 解析错误 | 输出不合契约 | 展示具体原因 + 「重试」按钮 |

任何情况都**不静默失败**，也不写入半成品。

## 落库与归档（`applyGeneratedPlan`）

用户点「应用到本周计划」后：

1. 现有 `weeklyPlan.days` 非空时，整体归档进 `history.weeks[]`（并记下当时的 `goal`）；
2. 写入新 `weeklyPlan`：`weekIndex` 递增，`startDate` 取新餐单首日，标记 `generatedBy: "cloud-llm"` 与 `generatedAt`；
3. `confirmed: true`（用户已显式点击应用）；
4. 保存并提示。

## 每日宏量核算（`planDayMacros`）

生成结果只存食材与份量，不存宏量快照（与 `favoriteMeals` 同思路）。预览时按 `findFood(name)` 查当前食材库实时折算，再把每天合计与目标对比，落在 ±12% 内标绿。这样食材库调整后，预览数字自动跟随。
