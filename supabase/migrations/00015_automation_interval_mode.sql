ALTER TABLE automation_configs
ADD COLUMN IF NOT EXISTS interval_mode TEXT;

UPDATE automation_configs
SET interval_mode = 'fixed_5m'
WHERE interval_mode IS NULL AND COALESCE(interval_minutes, 0) <= 5;

UPDATE automation_configs
SET interval_mode = 'jitter_2_5_3_5h'
WHERE interval_mode IS NULL;
