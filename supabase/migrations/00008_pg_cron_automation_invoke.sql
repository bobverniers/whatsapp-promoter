-- Supabase invokes your deployed Next cron route via pg_cron + pg_net (replaces GitHub Actions scheduler).
--
-- Prerequisites (Dashboard → Database → Extensions): enable pg_cron and pg_net if not already.
--
-- Configure after deploy:
--   INSERT INTO private.automation_invoker_config (id, automations_url, cron_secret)
--   VALUES (1, 'https://YOUR_DOMAIN/api/cron/automations/run', 'YOUR_CRON_SECRET')
--   ON CONFLICT (id) DO UPDATE SET
--     automations_url = EXCLUDED.automations_url,
--     cron_secret = EXCLUDED.cron_secret,
--     updated_at = NOW();
--
-- Secrets are not stored in this repo; use the SQL Editor with your production URL and CRON_SECRET.
-- The job no-ops with a NOTICE when URL or secret is empty.

CREATE SCHEMA IF NOT EXISTS private;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS private.automation_invoker_config (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  automations_url TEXT NOT NULL DEFAULT '',
  cron_secret TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.automation_invoker_config WHERE id = 1) THEN
    INSERT INTO private.automation_invoker_config (id)
    VALUES (1);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.invoke_automations_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req_url TEXT;
  req_secret TEXT;
BEGIN
  SELECT c.automations_url, c.cron_secret
  INTO req_url, req_secret
  FROM private.automation_invoker_config c
  WHERE c.id = 1;

  IF req_url IS NULL OR trim(req_url) = '' THEN
    RAISE NOTICE 'automation cron: automation_invoker_config.automations_url is empty — skipping POST';
    RETURN;
  END IF;

  IF req_secret IS NULL OR trim(req_secret) = '' THEN
    RAISE NOTICE 'automation cron: automation_invoker_config.cron_secret is empty — skipping POST';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := trim(req_url),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || trim(req_secret),
      'Accept', 'application/json'
    ),
    body := '{}'::jsonb
  );
END;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE command LIKE '%private.invoke_automations_cron%'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'group_messenger_automations_invoke',
  '*/15 * * * *',
  'SELECT private.invoke_automations_cron();'
);

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON TABLE private.automation_invoker_config FROM PUBLIC;
