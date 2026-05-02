-- Move from single automation config to multiple automation records.
-- Keep old columns for backward compatibility; new UI/runner use group_ids + interval_minutes.

ALTER TABLE automation_configs
ADD COLUMN IF NOT EXISTS group_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

ALTER TABLE automation_configs
ADD COLUMN IF NOT EXISTS interval_minutes INT NOT NULL DEFAULT 15;

ALTER TABLE automation_configs
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Snapshot selected groups from previous include list when possible.
UPDATE automation_configs
SET group_ids = group_include_ids
WHERE
  (group_ids IS NULL OR array_length(group_ids, 1) IS NULL)
  AND group_include_ids IS NOT NULL;

-- Best-effort interval conversion from old cron_expr values.
UPDATE automation_configs
SET interval_minutes = CASE
  WHEN cron_expr = '*/5 * * * *' THEN 5
  WHEN cron_expr = '*/15 * * * *' THEN 15
  WHEN cron_expr = '0 * * * *' THEN 60
  WHEN cron_expr = '0 */3 * * *' THEN 180
  ELSE interval_minutes
END;

CREATE INDEX IF NOT EXISTS idx_automation_configs_live
  ON automation_configs(enabled, deleted_at, updated_at DESC);

ALTER TABLE automation_runs
ADD COLUMN IF NOT EXISTS automation_name TEXT;
