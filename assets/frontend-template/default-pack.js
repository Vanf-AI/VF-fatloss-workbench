// 减脂工作台 · 默认空包（占位骨架）
//
// 用途：首次登录且云端无数据时，前端以本文件为初始状态（revision 0）。
// 关键：logs 为空对象 → 不触发 auto-seed（不会把示例数据写进云端）。
//
// 部署时：用 Agent 生成的真实 FatLossPack 替换 window.__FATLOSS_DEFAULT_PACK__ 的值
//        （保持变量名与 JSON 结构不变），或保持本空骨架让用户登录后自行导入。
//
// 红线：本文件是公开可读的静态文件，严禁写入任何真实个人数据
//      （体重 / 档案 / 餐单 / 记录 / 邮箱 / 云端凭据）。
window.__FATLOSS_DEFAULT_PACK__ = {
  protocol: "fatlosspack",
  schemaVersion: "1.0.0",
  screening: {
    age: null,
    pregnantOrBreastfeeding: false,
    eatingDisorderRisk: false,
    majorCondition: false,
    concerningSymptoms: false,
    mode: "personalized",
    reviewedAt: null
  },
  profile: {
    gender: "male",
    weight: 70,
    targetWeight: 65,
    exerciseHours: 4,
    exerciseTimes: 4,
    startDate: "2026-01-01"
  },
  method: { id: "lifestyle" },
  goal: { carb: 0, protein: 0, fat: 0, kcal: 0 },
  fixedIntakes: { proteinPowder: 0, milk: 0, note: "" },
  supplements: { blueberries: false, vegetables: false, pumpkinSeeds: false, nuts: false },
  foodLibrary: { selected: [], hidden: [], custom: [] },
  weeklyPlan: {
    confirmed: false,
    weekIndex: 1,
    startDate: "2026-01-01",
    days: [],
    shopping: [],
    nutritionTotals: []
  },
  logs: {},
  reviews: [],
  favoriteMeals: [],
  history: { weeks: [], reviews: [] }
};
