-- Tighter tick for manual testing — Supabase wakes Vercel every 5 minutes.
-- Per-automation send cadence stays controlled by automation_configs.interval_minutes (UI).

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'group_messenger_automations_invoke'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'group_messenger_automations_invoke',
  '*/5 * * * *',
  'SELECT private.invoke_automations_cron();'
);
