// FatLossPack 1.0.0 校验逻辑（被 validate_fatlosspack.mjs 与生成器共用）。
// 纯逻辑，无外部依赖。返回错误数组；空数组表示通过。

export const PROTOCOL = "fatlosspack";
export const SCHEMA_VERSION = "1.0.0";
export const METHOD_IDS = ["lifestyle", "carb-cycle", "recomposition"];
export const MEAL_NAMES = ["早餐", "午餐", "晚餐", "加餐"];
export const SCREENING_MODES = ["pending", "personalized", "record-only"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string";
const isBool = (v) => typeof v === "boolean";

export function validateFatLossPack(pack) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });

  if (!isObj(pack)) {
    err("$", "FatLossPack 必须是对象");
    return errors;
  }
  if (pack.protocol !== PROTOCOL) err("protocol", `必须为 "${PROTOCOL}"`);
  if (pack.schemaVersion !== SCHEMA_VERSION)
    err("schemaVersion", `必须为 "${SCHEMA_VERSION}"`);

  // screening
  const s = pack.screening;
  if (!isObj(s)) err("screening", "缺失或非对象");
  else {
    if (s.age !== null && s.age !== undefined && !isNum(s.age))
      err("screening.age", "应为数字或 null");
    for (const k of [
      "pregnantOrBreastfeeding",
      "eatingDisorderRisk",
      "majorCondition",
      "concerningSymptoms",
    ]) {
      if (!isBool(s[k])) err(`screening.${k}`, "应为布尔");
    }
    if (!SCREENING_MODES.includes(s.mode))
      err("screening.mode", `必须为 ${SCREENING_MODES.join(" / ")}`);
  }

  // profile
  const p = pack.profile;
  if (!isObj(p)) err("profile", "缺失或非对象");
  else {
    if (!["male", "female"].includes(p.gender))
      err("profile.gender", "必须为 male / female");
    if (!isNum(p.weight) || p.weight <= 0)
      err("profile.weight", "应为正数");
    if (p.targetWeight !== undefined && p.targetWeight !== null &&
        (!isNum(p.targetWeight) || p.targetWeight <= 0))
      err("profile.targetWeight", "应为正数");
    if (!isNum(p.exerciseHours) || p.exerciseHours < 0)
      err("profile.exerciseHours", "应为非负数");
    if (!isNum(p.exerciseTimes) || p.exerciseTimes < 0)
      err("profile.exerciseTimes", "应为非负数");
    if (!isStr(p.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(p.startDate))
      err("profile.startDate", "应为 YYYY-MM-DD");
  }

  // method
  const m = pack.method;
  if (!isObj(m)) err("method", "缺失或非对象");
  else {
    if (!METHOD_IDS.includes(m.id))
      err("method.id", `必须为 ${METHOD_IDS.join(" / ")}`);
    if (m.id === "carb-cycle") validateCarbCycle(m, err);
    if (m.id === "recomposition") validateRecomposition(m, err);
  }

  // goal（record-only 可空）
  const g = pack.goal;
  const recordOnly = isObj(s) && s.mode === "record-only";
  if (!g && !recordOnly) err("goal", "非 record-only 时必填");
  if (isObj(g)) {
    for (const k of ["carb", "protein", "fat", "kcal"]) {
      if (!isNum(g[k]) || g[k] < 0) err(`goal.${k}`, "应为非负数");
    }
    if (isNum(g.carb) && isNum(g.protein) && isNum(g.fat)) {
      const expect = g.carb * 4 + g.protein * 4 + g.fat * 9;
      if (isNum(g.kcal) && Math.abs(g.kcal - expect) > 1)
        err("goal.kcal", `应为 carb*4+protein*4+fat*9 ≈ ${expect}，实得 ${g.kcal}`);
    }
  }

  // fixedIntakes / supplements / foodLibrary
  const fi = pack.fixedIntakes;
  if (!isObj(fi)) err("fixedIntakes", "缺失或非对象");
  else {
    if (!isNum(fi.proteinPowder)) err("fixedIntakes.proteinPowder", "应为数字");
    if (!isNum(fi.milk)) err("fixedIntakes.milk", "应为数字");
    if (!isStr(fi.note)) err("fixedIntakes.note", "应为字符串");
  }
  const sup = pack.supplements;
  if (!isObj(sup)) err("supplements", "缺失或非对象");
  else {
    for (const k of ["blueberries", "vegetables", "pumpkinSeeds", "nuts"]) {
      if (!isBool(sup[k])) err(`supplements.${k}`, "应为布尔");
    }
  }
  const fl = pack.foodLibrary;
  if (!isObj(fl)) err("foodLibrary", "缺失或非对象");
  else {
    for (const k of ["selected", "hidden", "custom"]) {
      if (!Array.isArray(fl[k])) err(`foodLibrary.${k}`, "应为数组");
    }
    if (Array.isArray(fl.custom)) {
      fl.custom.forEach((c, i) => {
        if (!isObj(c)) err(`foodLibrary.custom[${i}]`, "应为对象");
      });
    }
  }

  // weeklyPlan（可选；存在则校验结构）
  if (pack.weeklyPlan !== undefined && pack.weeklyPlan !== null) {
    validateWeeklyPlan(pack.weeklyPlan, err);
  }

  // reviews
  if (pack.reviews !== undefined && !Array.isArray(pack.reviews))
    err("reviews", "应为数组");

  // logs（可选；存在则校验 meals.items 结构）
  if (pack.logs !== undefined) {
    if (!isObj(pack.logs)) err("logs", "应为对象");
    else validateLogs(pack.logs, err);
  }

  return errors;
}

function validateLogs(logs, err) {
  Object.entries(logs).forEach(([day, entry]) => {
    if (!isObj(entry)) return err(`logs.${day}`, "应为对象");
    if (entry.meals === undefined) return;
    if (!isObj(entry.meals)) return err(`logs.${day}.meals`, "应为对象");
    Object.entries(entry.meals).forEach(([mealName, meal]) => {
      if (!MEAL_NAMES.includes(mealName))
        err(`logs.${day}.meals`, `餐名必须为 ${MEAL_NAMES.join(" / ")}，实得 ${mealName}`);
      if (!isObj(meal)) return err(`logs.${day}.meals.${mealName}`, "应为对象");
      if (!Array.isArray(meal.items))
        return err(`logs.${day}.meals.${mealName}.items`, "应为数组");
      meal.items.forEach((it, i) => {
        if (!isObj(it)) return err(`logs.${day}.meals.${mealName}.items[${i}]`, "应为对象");
        if (!isStr(it.name)) err(`logs.${day}.meals.${mealName}.items[${i}].name`, "应为字符串");
        if (!isNum(it.amount) || it.amount <= 0)
          err(`logs.${day}.meals.${mealName}.items[${i}].amount`, "应为正数");
        if (it.unit !== undefined && !isStr(it.unit))
          err(`logs.${day}.meals.${mealName}.items[${i}].unit`, "应为字符串");
        for (const k of ["carb", "protein", "fat"]) {
          if (!isNum(it[k]))
            err(`logs.${day}.meals.${mealName}.items[${i}].${k}`, "应为数字");
        }
      });
    });
  });
}

function validateCarbCycle(m, err) {
  if (!Array.isArray(m.phases) || m.phases.length === 0) {
    err("method.phases", "carb-cycle 必须含非空 phases[]");
    return;
  }
  m.phases.forEach((ph, i) => {
    if (!isObj(ph)) return err(`method.phases[${i}]`, "应为对象");
    if (!isNum(ph.index)) err(`method.phases[${i}].index`, "应为数字");
    if (!isStr(ph.name)) err(`method.phases[${i}].name`, "应为字符串");
    for (const k of ["carb", "protein", "fat"]) {
      if (!isNum(ph[k]) || ph[k] <= 0)
        err(`method.phases[${i}].${k}`, "应为正数（g/kg）");
    }
    if (!isStr(ph.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(ph.startDate))
      err(`method.phases[${i}].startDate`, "应为 YYYY-MM-DD");
    if (!isNum(ph.days) || ph.days <= 0)
      err(`method.phases[${i}].days`, "应为正数");
    if (!isBool(ph.isHighCarb))
      err(`method.phases[${i}].isHighCarb`, "应为布尔");
  });
}

function validateRecomposition(m, err) {
  const r = m.ranges;
  if (!isObj(r)) return err("method.ranges", "recomposition 必须有 ranges");
  for (const k of ["carb", "protein", "fat"]) {
    const v = r[k];
    if (!Array.isArray(v) || v.length !== 2 || !isNum(v[0]) || !isNum(v[1])) {
      err(`method.ranges.${k}`, "应为 [min,max] 数字");
    } else if (v[0] > v[1]) {
      err(`method.ranges.${k}`, "min 不得大于 max");
    }
  }
  const sp = m.startPoint;
  if (!isObj(sp)) return err("method.startPoint", "recomposition 必须有 startPoint");
  for (const k of ["carb", "protein", "fat"]) {
    if (!isNum(sp[k])) err(`method.startPoint.${k}`, "应为数字");
    else if (isObj(r) && Array.isArray(r[k]) && (sp[k] < r[k][0] || sp[k] > r[k][1]))
      err(`method.startPoint.${k}`, `须落在 ranges.${k} 内`);
  }
  if (!Array.isArray(m.stateSignals)) err("method.stateSignals", "应为数组");
}

function validateWeeklyPlan(wp, err) {
  if (!isObj(wp)) return err("weeklyPlan", "应为对象");
  if (!isBool(wp.confirmed)) err("weeklyPlan.confirmed", "应为布尔");
  if (!Array.isArray(wp.days)) return err("weeklyPlan.days", "应为数组");
  let reviewDays = 0;
  wp.days.forEach((d, i) => {
    if (!isObj(d)) return err(`weeklyPlan.days[${i}]`, "应为对象");
    if (!isNum(d.day)) err(`weeklyPlan.days[${i}].day`, "应为数字");
    if (!isStr(d.date) || !/^\d{4}-\d{2}-\d{2}$/.test(d.date))
      err(`weeklyPlan.days[${i}].date`, "应为 YYYY-MM-DD");
    if (!isBool(d.reviewDay)) err(`weeklyPlan.days[${i}].reviewDay`, "应为布尔");
    else if (d.reviewDay) reviewDays++;
    if (!Array.isArray(d.meals)) return err(`weeklyPlan.days[${i}].meals`, "应为数组");
    d.meals.forEach((meal, j) => {
      if (!MEAL_NAMES.includes(meal.name))
        err(`weeklyPlan.days[${i}].meals[${j}].name`, `必须为 ${MEAL_NAMES.join(" / ")}`);
      if (!Array.isArray(meal.ingredients))
        err(`weeklyPlan.days[${i}].meals[${j}].ingredients`, "应为数组");
    });
  });
  if (wp.days.length > 0 && reviewDays !== 1)
    err("weeklyPlan.days", "每周应恰有 1 个 reviewDay");
}
