#!/usr/bin/env node
import fs from "node:fs";
import { validateFatLossPack, PROTOCOL, SCHEMA_VERSION } from "./protocol.mjs";

const filename = process.argv[2];
if (!filename) {
  console.error("Usage: node validate_fatlosspack.mjs <fatlosspack.json>");
  process.exit(2);
}

let pack;
try {
  pack = JSON.parse(fs.readFileSync(filename, "utf8"));
} catch (error) {
  console.error(`INVALID_JSON: ${error.message}`);
  process.exit(1);
}

const errors = validateFatLossPack(pack);
if (errors.length) {
  console.error(errors.map(({ path, message }) => `- ${path}: ${message}`).join("\n"));
  process.exit(1);
}

const collections = ["foodLibrary", "weeklyPlan", "logs", "reviews", "favoriteMeals", "history"];
console.log(
  JSON.stringify(
    {
      valid: true,
      protocol: PROTOCOL,
      schemaVersion: SCHEMA_VERSION,
      method: pack.method?.id,
      goal: pack.goal,
      weeks: pack.weeklyPlan ? pack.weeklyPlan.days.length : 0,
    },
    null,
    2,
  ),
);
