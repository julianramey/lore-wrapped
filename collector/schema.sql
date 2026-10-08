-- lore's collector: counters for the index, refusals, and the waitlist. No rows of stats live here.
CREATE TABLE IF NOT EXISTS counts (
  month TEXT NOT NULL,
  k TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (month, k)
);
CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  team INTEGER NOT NULL,
  day TEXT NOT NULL
);
-- Refused stats payloads by month and their first problem: a field name ("bad tokens"), never
-- a value, a key or anything about the request. Added in lore 0.4.3; on a database made
-- before it, run once from collector/:
--   npx wrangler d1 execute lore --remote --file schema.sql
-- (every statement here is IF NOT EXISTS). Read it with:
--   npx wrangler d1 execute lore --remote --command "SELECT * FROM rejects ORDER BY month, n DESC"
CREATE TABLE IF NOT EXISTS rejects (
  month TEXT NOT NULL,
  reason TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (month, reason)
);
