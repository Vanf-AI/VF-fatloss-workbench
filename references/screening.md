# 健康筛查与禁忌路由

在采集档案后立即执行，结果写入 `screening`。本研究材料没有提供个体医疗筛查或针对疾病、孕哺期、未成年人的调整规则，因此下列情形**不得自动套用任何方法的目标计算**。

## 筛查项

| 字段 | 含义 |
| --- | --- |
| `age` | 年龄（可空）；未成年（<18）触发路由 |
| `pregnantOrBreastfeeding` | 孕哺期 |
| `eatingDisorderRisk` | 进食障碍风险 |
| `majorCondition` | 重大疾病史 |
| `concerningSymptoms` | 可疑症状（如持续头晕、心悸、月经紊乱等） |

## 路由规则

- 任一项为 `true`（或 `age < 18`）：`screening.mode = "record-only"`，并告知用户建议先咨询具备资质的医疗/营养专业人士；Skill 只承载记录，不生成目标与餐单。
- 全部为 `false` 且用户确认：`mode = "personalized"`，正常进入方法选择与算目标。
- 尚未判定：`mode = "pending"`，不得输出 `goal` / `weeklyPlan`。

## 其它

- `reviewedAt` 记录筛查完成时间；`mode` 变更须重新评估。
- 健康敏感信息只在 `screening` 内，不进入 `goal`、日志或公开字段。
- 用户询问健康问题时区分方法口径与医学判断；明显不适时不继续压低摄入。
