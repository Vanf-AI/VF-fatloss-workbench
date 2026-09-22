CREATE TABLE IF NOT EXISTS fatloss_document (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  document_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS access_tokens (
  mode TEXT PRIMARY KEY CHECK (mode IN ('edit', 'read')),
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO fatloss_document (id, revision, document_json)
VALUES (
  1,
  1,
  '{"protocol":"fatlosspack","schemaVersion":"1.0.0","screening":{"age":null,"pregnantOrBreastfeeding":false,"eatingDisorderRisk":false,"majorCondition":false,"concerningSymptoms":false,"mode":"pending","reviewedAt":null},"profile":{"gender":"female","weight":0,"exerciseHours":0,"exerciseTimes":0,"startDate":"2026-01-01"},"method":{"id":"lifestyle"},"goal":null,"fixedIntakes":{"proteinPowder":0,"milk":0,"note":""},"supplements":{"blueberries":false,"vegetables":false,"pumpkinSeeds":false,"nuts":false},"foodLibrary":{"selected":[],"hidden":[],"custom":[]},"weeklyPlan":null,"logs":{},"reviews":[],"favoriteMeals":[],"history":{"weeks":[],"reviews":[]}}'
);
