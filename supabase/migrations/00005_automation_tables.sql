CREATE TABLE automation_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL DEFAULT 'Default Automation',
  enabled BOOLEAN NOT NULL DEFAULT false,
  cron_expr TEXT NOT NULL DEFAULT '*/5 * * * *',
  group_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  group_include_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  group_exclude_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  template_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE automation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id UUID NOT NULL REFERENCES automation_configs(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  groups_targeted INT NOT NULL DEFAULT 0,
  groups_sent INT NOT NULL DEFAULT 0,
  groups_failed INT NOT NULL DEFAULT 0,
  error_summary TEXT
);

CREATE INDEX idx_automation_runs_automation_started
  ON automation_runs(automation_id, started_at DESC);
