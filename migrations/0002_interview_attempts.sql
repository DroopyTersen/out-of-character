CREATE TABLE interview_attempts (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  interviewer_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER,
  archive_state TEXT NOT NULL CHECK (archive_state IN ('partial', 'final')),
  session_status TEXT NOT NULL,
  finalization TEXT NOT NULL,
  feedback_status TEXT NOT NULL,
  usage_seconds REAL,
  message TEXT,
  transcript_json TEXT NOT NULL,
  evaluation_json TEXT,
  summary_status TEXT NOT NULL CHECK (summary_status IN ('pending', 'ready', 'unavailable')),
  summary_text TEXT,
  provenance_json TEXT NOT NULL,
  cues_json TEXT NOT NULL
);

CREATE INDEX interview_attempts_updated_at ON interview_attempts(updated_at);
