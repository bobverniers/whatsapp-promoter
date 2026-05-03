-- Remove unused automation config columns from earlier iterations.
ALTER TABLE automation_configs DROP COLUMN IF EXISTS cron_expr;
ALTER TABLE automation_configs DROP COLUMN IF EXISTS group_tags;
ALTER TABLE automation_configs DROP COLUMN IF EXISTS group_exclude_ids;
ALTER TABLE automation_configs DROP COLUMN IF EXISTS group_include_ids;

-- Optional quiet hours per automation (local wall-clock in schedule_tz).
-- When both *_hour columns are NULL, there is no time restriction.
-- Active when: active_start_hour <= localHour < active_end_exclusive
-- Example: start 9 / end 22 → hours 09..21 inclusive of local wall-clock.
ALTER TABLE automation_configs
ADD COLUMN IF NOT EXISTS schedule_tz TEXT DEFAULT 'UTC',

ADD COLUMN IF NOT EXISTS active_start_hour SMALLINT,
ADD COLUMN IF NOT EXISTS active_end_exclusive SMALLINT;

ALTER TABLE automation_configs
DROP CONSTRAINT IF EXISTS chk_automation_active_hours;

ALTER TABLE automation_configs ADD CONSTRAINT chk_automation_active_hours CHECK (
  (active_start_hour IS NULL AND active_end_exclusive IS NULL)
  OR (
    active_start_hour IS NOT NULL
    AND active_end_exclusive IS NOT NULL
    AND active_start_hour >= 0 AND active_start_hour <= 23
    AND active_end_exclusive >= 1 AND active_end_exclusive <= 24
    AND active_start_hour < active_end_exclusive
  )
);

COMMENT ON COLUMN automation_configs.schedule_tz IS 'IANA zone for active hour window; defaults to UTC';
COMMENT ON COLUMN automation_configs.active_start_hour IS 'Inclusive start hour (0–23)';
COMMENT ON COLUMN automation_configs.active_end_exclusive IS 'Exclusive end hour (1–24), e.g. 22 ⇒ last eligible hour is 21';
