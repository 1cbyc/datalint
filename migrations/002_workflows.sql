ALTER TABLE data_sources DROP CONSTRAINT IF EXISTS data_sources_kind_check;
ALTER TABLE data_sources ADD CONSTRAINT data_sources_kind_check CHECK (kind IN ('csv', 'google_sheets', 'json_api'));
ALTER TABLE data_sources ALTER COLUMN file_name DROP NOT NULL;
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS connector_url TEXT;
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS record_path TEXT;
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS schedule_minutes INTEGER;
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'ready' CHECK (sync_status IN ('ready', 'syncing', 'failed'));
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS sync_error TEXT;

ALTER TABLE rules DROP CONSTRAINT IF EXISTS rules_type_check;
ALTER TABLE rules ADD CONSTRAINT rules_type_check CHECK (type IN ('required', 'unique', 'email', 'number_range', 'allowed_values', 'pattern', 'numeric_outlier', 'row_count_change'));

CREATE TABLE IF NOT EXISTS source_syncs (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  row_count INTEGER,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_syncs_source_finished ON source_syncs(source_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS issue_events (
  id UUID PRIMARY KEY,
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('opened', 'reopened', 'resolved', 'auto_resolved')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  alerted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_issue_events_issue_created ON issue_events(issue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_events_pending_alert ON issue_events(created_at) WHERE alerted_at IS NULL AND type IN ('opened', 'reopened');
