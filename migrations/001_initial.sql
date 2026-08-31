CREATE TABLE IF NOT EXISTS data_sources (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  columns_json JSONB NOT NULL,
  rows_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT data_sources_kind_check CHECK (kind IN ('csv', 'google_sheets', 'json_api'))
);

CREATE TABLE IF NOT EXISTS rules (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  column_name TEXT NOT NULL,
  config_json JSONB NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT rules_type_check CHECK (type IN ('required', 'unique', 'email', 'number_range', 'allowed_values', 'pattern', 'numeric_outlier', 'row_count_change'))
);

CREATE INDEX IF NOT EXISTS idx_rules_source_id ON rules(source_id);

CREATE TABLE IF NOT EXISTS check_runs (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  rows_scanned INTEGER NOT NULL,
  checks_evaluated INTEGER NOT NULL,
  issues_found INTEGER NOT NULL,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 100)
);

CREATE INDEX IF NOT EXISTS idx_check_runs_source_started ON check_runs(source_id, started_at DESC);

CREATE TABLE IF NOT EXISTS issues (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES check_runs(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  row_number INTEGER,
  column_name TEXT NOT NULL,
  message TEXT NOT NULL,
  observed_value TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  UNIQUE(rule_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_issues_status_last_seen ON issues(status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_source_status ON issues(source_id, status);
