-- lore's collector: counters for the index, and the waitlist. No rows of stats live here.
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
