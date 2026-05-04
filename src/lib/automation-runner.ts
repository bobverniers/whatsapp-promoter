import { supabase } from "@/lib/supabase";
import { looksLikeKickOrForbidden, sendWhapiText } from "@/lib/whapi-send";

export type AutomationRow = {
  id: string;
  name: string;
  enabled: boolean;
  interval_minutes: number | null;
  group_ids: string[] | null;
  template_ids: string[] | null;
  schedule_tz?: string | null;
  active_start_hour?: number | null;
  active_end_exclusive?: number | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type AutomationExecutionResult = {
  automationId: string;
  automationName: string;
  status: "success" | "partial" | "failed" | "skipped";
  reason?: string;
  runId: string | null;
  groupsTargeted: number;
  groupsSent: number;
  groupsFailed: number;
  templateId: string | null;
  messages: string[];
};

export type AutomationBatchSummary = {
  startedAt: string;
  finishedAt: string;
  attempted: number;
  executed: number;
  skipped: number;
  totalSent: number;
  totalFailed: number;
  results: AutomationExecutionResult[];
};

type GroupRow = {
  id: string;
  whapi_id: string;
  name: string | null;
  is_active: boolean;
};

type TemplateRow = {
  id: string;
  content: string;
  use_count: number;
  last_used_at: string | null;
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function buildMessageBody(templateContent: string, promoLink?: string) {
  if (!templateContent.includes("{{link}}")) {
    return { ok: true as const, body: templateContent };
  }
  const link = promoLink?.trim();
  if (!link) {
    return {
      ok: false as const,
      error:
        'Template contains {{link}} but PROMO_LINK is not set in environment variables.',
    };
  }
  return {
    ok: true as const,
    body: templateContent.split("{{link}}").join(link),
  };
}

function pickRotatedTemplate(pool: TemplateRow[]): TemplateRow | null {
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => {
    if (a.use_count !== b.use_count) return a.use_count - b.use_count;
    const ta = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
    const tb = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
    return ta - tb;
  })[0];
}

function isDue(nowMs: number, row: AutomationRow): boolean {
  const mins =
    typeof row.interval_minutes === "number" && row.interval_minutes > 0
      ? row.interval_minutes
      : 15;
  if (!row.last_run_at) return true;
  const last = new Date(row.last_run_at).getTime();
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= mins * 60_000;
}

function localWallHour(now: Date, timeZone: string): number | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    });
    const h = Number.parseInt(formatter.format(now), 10);
    return Number.isFinite(h) ? h : null;
  } catch {
    return null;
  }
}

function outsideActiveHourWindow(nowMs: number, row: AutomationRow): boolean {
  const start = row.active_start_hour ?? null;
  const endExclusive = row.active_end_exclusive ?? null;

  if (start == null || endExclusive == null) return false;

  const tz =
    typeof row.schedule_tz === "string" && row.schedule_tz.trim().length > 0
      ? row.schedule_tz.trim()
      : "UTC";

  const hour = localWallHour(new Date(nowMs), tz);
  if (hour === null) return false;

  return hour < start || hour >= endExclusive;
}

/**
 * Atomic claim to prevent duplicate execution across overlapping cron invocations.
 * We only claim if last_run_at still matches what we loaded.
 */
async function claimAutomationExecution(
  row: AutomationRow,
  claimIso: string
): Promise<boolean> {
  let query = supabase
    .from("automation_configs")
    .update({ last_run_at: claimIso, updated_at: claimIso })
    .eq("id", row.id)
    .eq("enabled", true)
    .is("deleted_at", null);

  if (row.last_run_at === null) {
    query = query.is("last_run_at", null);
  } else {
    query = query.eq("last_run_at", row.last_run_at);
  }

  const { data, error } = await query.select("id").maybeSingle();
  if (error) return false;
  return Boolean(data?.id);
}

async function executeOneAutomation(
  row: AutomationRow,
  token: string,
  nowIso: string
): Promise<AutomationExecutionResult> {
  const messages: string[] = [];
  let runId: string | null = null;
  let groupsSent = 0;
  let groupsFailed = 0;
  let templateId: string | null = null;

  const groupIds = asStringArray(row.group_ids);
  const templateIds = asStringArray(row.template_ids);

  const baseResult = {
    automationId: row.id,
    automationName: row.name,
    runId: null as string | null,
    groupsTargeted: 0,
    groupsSent: 0,
    groupsFailed: 0,
    templateId: null as string | null,
    messages,
  };

  if (groupIds.length === 0) {
    return {
      ...baseResult,
      status: "skipped",
      reason: "No groups selected",
    };
  }

  if (templateIds.length === 0) {
    return {
      ...baseResult,
      status: "skipped",
      reason: "No templates selected",
    };
  }

  const { data: groups, error: groupErr } = await supabase
    .from("external_groups")
    .select("id, whapi_id, name, is_active")
    .in("id", groupIds)
    .eq("is_active", true);
  if (groupErr) {
    return {
      ...baseResult,
      status: "failed",
      reason: `Failed to load groups: ${groupErr.message}`,
    };
  }

  const targets = (groups ?? []) as GroupRow[];
  const groupsTargeted = targets.length;
  if (groupsTargeted === 0) {
    return {
      ...baseResult,
      status: "skipped",
      reason: "No active selected groups",
    };
  }

  const { data: templates, error: templateErr } = await supabase
    .from("promo_templates")
    .select("id, content, use_count, last_used_at")
    .in("id", templateIds);
  if (templateErr) {
    return {
      ...baseResult,
      groupsTargeted,
      status: "failed",
      reason: `Failed to load templates: ${templateErr.message}`,
    };
  }

  const pool = (templates ?? []) as TemplateRow[];
  const selected = pickRotatedTemplate(pool);
  if (!selected) {
    return {
      ...baseResult,
      groupsTargeted,
      status: "failed",
      reason: "No template from selected pool was found",
    };
  }
  templateId = selected.id;

  const built = buildMessageBody(selected.content, process.env.PROMO_LINK);
  if (!built.ok) {
    return {
      ...baseResult,
      groupsTargeted,
      templateId,
      status: "failed",
      reason: built.error,
    };
  }

  const runIns = await supabase
    .from("automation_runs")
    .insert({
      automation_id: row.id,
      automation_name: row.name,
      status: "running",
      groups_targeted: groupsTargeted,
      groups_sent: 0,
      groups_failed: 0,
    })
    .select("id")
    .single();
  if (runIns.error || !runIns.data) {
    return {
      ...baseResult,
      groupsTargeted,
      templateId,
      status: "failed",
      reason: `Failed to create run log: ${runIns.error?.message ?? "unknown"}`,
    };
  }
  runId = runIns.data.id;

  for (const g of targets) {
    const send = await sendWhapiText(token, g.whapi_id, built.body);
    if (!send.ok) {
      groupsFailed += 1;
      messages.push(
        `Send failed for ${g.name ?? g.whapi_id}: HTTP ${send.status}`
      );
      if (looksLikeKickOrForbidden(send.status)) {
        await supabase
          .from("external_groups")
          .update({
            is_active: false,
            status_notes: `Automation ${row.name}: Whapi ${send.status} at ${nowIso}`,
          })
          .eq("id", g.id);
      }
      continue;
    }
    groupsSent += 1;
    await supabase
      .from("external_groups")
      .update({ last_promoted_at: nowIso })
      .eq("id", g.id);
  }

  let status: "success" | "partial" | "failed" = "failed";
  if (groupsSent === groupsTargeted) status = "success";
  else if (groupsSent > 0) status = "partial";

  if (groupsSent > 0) {
    await supabase
      .from("promo_templates")
      .update({
        use_count: selected.use_count + 1,
        last_used_at: nowIso,
      })
      .eq("id", selected.id);
  }

  await supabase
    .from("automation_configs")
    .update({ last_run_at: nowIso, updated_at: nowIso })
    .eq("id", row.id);

  await supabase
    .from("automation_runs")
    .update({
      finished_at: nowIso,
      status,
      groups_sent: groupsSent,
      groups_failed: groupsFailed,
      error_summary: groupsFailed > 0 ? messages.join("; ").slice(0, 5000) : null,
    })
    .eq("id", runId);

  return {
    automationId: row.id,
    automationName: row.name,
    status,
    runId,
    groupsTargeted,
    groupsSent,
    groupsFailed,
    templateId,
    messages,
  };
}

export async function runScheduledAutomations(): Promise<AutomationBatchSummary> {
  const startedAt = new Date().toISOString();
  const nowMs = Date.now();
  const token = process.env.WHAPI_TOKEN;

  if (!token) {
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      attempted: 0,
      executed: 0,
      skipped: 0,
      totalSent: 0,
      totalFailed: 0,
      results: [
        {
          automationId: "none",
          automationName: "none",
          status: "failed",
          reason: "WHAPI_TOKEN is not configured",
          runId: null,
          groupsTargeted: 0,
          groupsSent: 0,
          groupsFailed: 0,
          templateId: null,
          messages: [],
        },
      ],
    };
  }

  const { data, error } = await supabase
    .from("automation_configs")
    .select("*")
    .eq("enabled", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as AutomationRow[];
  const results: AutomationExecutionResult[] = [];
  let executed = 0;
  let skipped = 0;
  let totalSent = 0;
  let totalFailed = 0;

  for (const row of rows) {
    if (!isDue(nowMs, row)) {
      skipped += 1;
      results.push({
        automationId: row.id,
        automationName: row.name,
        status: "skipped",
        reason: "Interval not elapsed yet",
        runId: null,
        groupsTargeted: 0,
        groupsSent: 0,
        groupsFailed: 0,
        templateId: null,
        messages: [],
      });
      continue;
    }

    if (outsideActiveHourWindow(nowMs, row)) {
      skipped += 1;
      results.push({
        automationId: row.id,
        automationName: row.name,
        status: "skipped",
        reason: "Outside active hours",
        runId: null,
        groupsTargeted: 0,
        groupsSent: 0,
        groupsFailed: 0,
        templateId: null,
        messages: [],
      });
      continue;
    }

    const claimIso = new Date().toISOString();
    const claimed = await claimAutomationExecution(row, claimIso);
    if (!claimed) {
      skipped += 1;
      results.push({
        automationId: row.id,
        automationName: row.name,
        status: "skipped",
        reason: "Claimed by another runner",
        runId: null,
        groupsTargeted: 0,
        groupsSent: 0,
        groupsFailed: 0,
        templateId: null,
        messages: [],
      });
      continue;
    }

    executed += 1;
    const res = await executeOneAutomation(row, token, new Date().toISOString());
    totalSent += res.groupsSent;
    totalFailed += res.groupsFailed;
    results.push(res);
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    attempted: rows.length,
    executed,
    skipped,
    totalSent,
    totalFailed,
    results,
  };
}
