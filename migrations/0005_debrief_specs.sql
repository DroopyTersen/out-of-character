CREATE TABLE IF NOT EXISTS debrief_specs (
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  base TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  record_json TEXT NOT NULL,
  PRIMARY KEY (id, version)
);
CREATE INDEX IF NOT EXISTS debrief_specs_latest ON debrief_specs (id, approved_at DESC);
