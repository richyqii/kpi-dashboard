CREATE TABLE IF NOT EXISTS kpi_versions (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  restored_from TEXT,
  rows_json TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  summary_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kpi_state (id INTEGER PRIMARY KEY CHECK (id = 1), current_id TEXT);
INSERT OR IGNORE INTO kpi_state (id, current_id) VALUES (1, NULL);
CREATE TABLE IF NOT EXISTS kpi_drafts (
  id TEXT PRIMARY KEY,
  base_id TEXT,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  restored_from TEXT,
  input_json TEXT NOT NULL,
  result_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kpi_auth_attempts (client TEXT PRIMARY KEY, failures INTEGER NOT NULL, expires_at INTEGER NOT NULL);
