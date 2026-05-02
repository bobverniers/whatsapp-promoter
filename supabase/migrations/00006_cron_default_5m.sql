-- Testing default: 5-minute cadence stored on config rows.
ALTER TABLE automation_configs
ALTER COLUMN cron_expr SET DEFAULT '*/5 * * * *';

UPDATE automation_configs
SET cron_expr = '*/5 * * * *'
WHERE cron_expr = '0 */3 * * *';
