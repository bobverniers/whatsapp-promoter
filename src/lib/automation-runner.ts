import { intervalRangeMinutes } from "@/lib/automation-intervals";
import { buildStableRotationOrder } from "@/lib/rotation-order";
import { supabase } from "@/lib/supabase";
import { looksLikeKickOrForbidden, sendWhapiText } from "@/lib/whapi-send";

export type AutomationRow = {
  id: string;
  name: string;
  enabled: boolean;
  interval_minutes: number | null;
  interval_mode?: string | null;
  group_ids: string[] | null;
  group_tags?: string[] | null;
  group_rotation_cursor?: number | null;
  group_rotation_order?: string[] | null;
  template_ids: string[] | null;
  template_tags?: string[] | null;
  template_rotation_cursor?: number | null;
  template_rotation_order?: string[] | null;
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

/** Locked/kicked chats tried in one run before giving up. */
const MAX_SEND_ATTEMPTS = 5;

async function deactivateLockedGroup(
  group: GroupRow,
  automationName: string,
  status: number,
  nowIso: string
) {
  await supabase
    .from("external_groups")
    .update({
      is_active: false,
      status_notes: `Automation ${automationName}: Whapi ${status} at ${nowIso}`,
    })
    .eq("id", group.id);
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function mergeOrderedIds(primaryIds: string[], secondaryIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of primaryIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of secondaryIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
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

function isDue(nowMs: number, row: AutomationRow): boolean {
  const [minMinutes, maxMinutes] = intervalRangeMinutes(
    row.interval_mode,
    row.interval_minutes
  );
  if (!row.last_run_at) return true;
  const last = new Date(row.last_run_at).getTime();
  if (!Number.isFinite(last)) return true;
  const dueMinutes = pickDeterministicMinutes(
    row.id,
    row.last_run_at,
    minMinutes,
    maxMinutes
  );
  return nowMs - last >= dueMinutes * 60_000;
}

function pickDeterministicMinutes(
  automationId: string,
  lastRunAt: string,
  minMinutes: number,
  maxMinutes: number
): number {
  if (maxMinutes <= minMinutes) return minMinutes;
  const seed = `${automationId}:${lastRunAt}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = (hash >>> 0) / 4294967295;
  const delta = maxMinutes - minMinutes;
  return minMinutes + normalized * delta;
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
  let groupsTargeted = 0;
  let templateId: string | null = null;
  let sentGroupChat: string | null = null;

  const groupIds = asStringArray(row.group_ids);
  const groupTags = asStringArray(row.group_tags);
  const templateIds = asStringArray(row.template_ids);
  const templateTags = asStringArray(row.template_tags);

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

  if (groupIds.length === 0 && groupTags.length === 0) {
    return {
      ...baseResult,
      status: "skipped",
      reason: "No groups or group tags selected",
    };
  }

  if (templateIds.length === 0 && templateTags.length === 0) {
    return {
      ...baseResult,
      status: "skipped",
      reason: "No templates or template tags selected",
    };
  }

  const [manualGroupsRes, tagGroupsRes] = await Promise.all([
    groupIds.length > 0
      ? supabase
          .from("external_groups")
          .select("id, whapi_id, name, is_active")
          .in("id", groupIds)
          .eq("is_active", true)
      : Promise.resolve({ data: [], error: null }),
    groupTags.length > 0
      ? supabase
          .from("external_groups")
          .select("id, whapi_id, name, is_active")
          .overlaps("tags", groupTags)
          .eq("is_active", true)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const groupErr = manualGroupsRes.error ?? tagGroupsRes.error;
  if (groupErr) {
    return {
      ...baseResult,
      status: "failed",
      reason: `Failed to load groups: ${groupErr.message}`,
    };
  }

  const manualGroups = (manualGroupsRes.data ?? []) as GroupRow[];
  const tagGroups = [...((tagGroupsRes.data ?? []) as GroupRow[])].sort((a, b) => {
    const an = (a.name ?? a.whapi_id).toLowerCase();
    const bn = (b.name ?? b.whapi_id).toLowerCase();
    if (an !== bn) return an.localeCompare(bn);
    return a.id.localeCompare(b.id);
  });
  const manualMap = new Map<string, GroupRow>();
  for (const g of manualGroups) {
    manualMap.set(g.id, g);
  }
  const tagMap = new Map<string, GroupRow>();
  for (const g of tagGroups) {
    tagMap.set(g.id, g);
  }
  const bootstrapGroupOrder = mergeOrderedIds(
    groupIds,
    tagGroups.map((g) => g.id)
  );
  const eligibleGroupIds = bootstrapGroupOrder;
  const groupLabel = (id: string) => {
    const g = manualMap.get(id) ?? tagMap.get(id);
    return g?.name ?? g?.whapi_id ?? id;
  };
  const orderedGroupIds = buildStableRotationOrder(
    asStringArray(row.group_rotation_order),
    eligibleGroupIds,
    bootstrapGroupOrder,
    (ids) =>
      [...ids].sort((a, b) => {
        const an = groupLabel(a).toLowerCase();
        const bn = groupLabel(b).toLowerCase();
        if (an !== bn) return an.localeCompare(bn);
        return a.localeCompare(b);
      })
  );
  const orderedTargets = orderedGroupIds
    .map((id) => manualMap.get(id) ?? tagMap.get(id))
    .filter((g): g is GroupRow => Boolean(g));
  const activeTargetsCount = orderedTargets.length;
  if (activeTargetsCount === 0) {
    return {
      ...baseResult,
      status: "skipped",
      reason: "No active selected groups",
    };
  }

  const currentCursor =
    typeof row.group_rotation_cursor === "number" &&
    Number.isFinite(row.group_rotation_cursor) &&
    row.group_rotation_cursor >= 0
      ? Math.floor(row.group_rotation_cursor)
      : 0;
  const startIdx = currentCursor % orderedTargets.length;
  const firstTarget = orderedTargets[startIdx];
  const firstGroupChat = firstTarget.name ?? firstTarget.whapi_id;

  const [manualTemplatesRes, tagTemplatesRes] = await Promise.all([
    templateIds.length > 0
      ? supabase
          .from("promo_templates")
          .select("id, content, use_count, last_used_at")
          .in("id", templateIds)
      : Promise.resolve({ data: [], error: null }),
    templateTags.length > 0
      ? supabase
          .from("promo_templates")
          .select("id, content, use_count, last_used_at")
          .overlaps("tags", templateTags)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const templateErr = manualTemplatesRes.error ?? tagTemplatesRes.error;
  if (templateErr) {
    return {
      ...baseResult,
      status: "failed",
      reason: `Failed to load templates: ${templateErr.message}`,
    };
  }

  const manualTemplates = (manualTemplatesRes.data ?? []) as TemplateRow[];
  const tagTemplates = [...((tagTemplatesRes.data ?? []) as TemplateRow[])].sort(
    (a, b) => {
      const ac = a.content.toLowerCase();
      const bc = b.content.toLowerCase();
      if (ac !== bc) return ac.localeCompare(bc);
      return a.id.localeCompare(b.id);
    }
  );
  const manualTemplateMap = new Map<string, TemplateRow>();
  for (const t of manualTemplates) manualTemplateMap.set(t.id, t);
  const tagTemplateMap = new Map<string, TemplateRow>();
  for (const t of tagTemplates) tagTemplateMap.set(t.id, t);
  const bootstrapTemplateOrder = mergeOrderedIds(
    templateIds,
    tagTemplates.map((t) => t.id)
  );
  const templateLabel = (id: string) => {
    const t = manualTemplateMap.get(id) ?? tagTemplateMap.get(id);
    return t?.content ?? id;
  };
  const orderedTemplateIds = buildStableRotationOrder(
    asStringArray(row.template_rotation_order),
    bootstrapTemplateOrder,
    bootstrapTemplateOrder,
    (ids) =>
      [...ids].sort((a, b) => {
        const ac = templateLabel(a).toLowerCase();
        const bc = templateLabel(b).toLowerCase();
        if (ac !== bc) return ac.localeCompare(bc);
        return a.localeCompare(b);
      })
  );
  const orderedTemplates = orderedTemplateIds
    .map((id) => manualTemplateMap.get(id) ?? tagTemplateMap.get(id))
    .filter((t): t is TemplateRow => Boolean(t));
  const activeTemplatesCount = orderedTemplates.length;
  if (activeTemplatesCount === 0) {
    return {
      ...baseResult,
      status: "failed",
      reason: "No template from selected pool was found",
    };
  }
  const currentTemplateCursor =
    typeof row.template_rotation_cursor === "number" &&
    Number.isFinite(row.template_rotation_cursor) &&
    row.template_rotation_cursor >= 0
      ? Math.floor(row.template_rotation_cursor)
      : 0;
  const chosenTemplateIdx = currentTemplateCursor % activeTemplatesCount;
  const selected = orderedTemplates[chosenTemplateIdx];
  if (!selected) {
    return {
      ...baseResult,
      status: "failed",
      reason: "No template from selected pool was found",
    };
  }
  templateId = selected.id;

  const built = buildMessageBody(selected.content, process.env.PROMO_LINK);
  if (!built.ok) {
    return {
      ...baseResult,
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
      groups_targeted: 1,
      groups_sent: 0,
      groups_failed: 0,
      group_chat: firstGroupChat,
      message_sent: built.body,
    })
    .select("id")
    .single();
  if (runIns.error || !runIns.data) {
    return {
      ...baseResult,
      templateId,
      status: "failed",
      reason: `Failed to create run log: ${runIns.error?.message ?? "unknown"}`,
    };
  }
  runId = runIns.data.id;

  const deactivatedIds = new Set<string>();
  const seenIds = new Set<string>();
  let lastAttempted: GroupRow | null = null;
  let sentTarget: GroupRow | null = null;
  const attemptLimit = Math.min(MAX_SEND_ATTEMPTS, orderedTargets.length);

  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    const target =
      orderedTargets[(startIdx + attempt) % orderedTargets.length];
    if (seenIds.has(target.id)) break;
    seenIds.add(target.id);
    lastAttempted = target;
    groupsTargeted += 1;
    const label = target.name ?? target.whapi_id;

    const send = await sendWhapiText(token, target.whapi_id, built.body);
    if (send.ok) {
      groupsSent = 1;
      sentGroupChat = label;
      sentTarget = target;
      await supabase
        .from("external_groups")
        .update({ last_promoted_at: nowIso })
        .eq("id", target.id);
      break;
    }

    groupsFailed += 1;
    messages.push(`Send failed for ${label}: HTTP ${send.status}`);

    if (!looksLikeKickOrForbidden(send.status)) {
      break;
    }

    deactivatedIds.add(target.id);
    await deactivateLockedGroup(target, row.name, send.status, nowIso);
    messages.push(`Skipped locked chat ${label}; trying next group`);
  }

  const remainingOrder = orderedGroupIds.filter(
    (id) => !deactivatedIds.has(id)
  );
  const cursorAnchorId = sentTarget?.id ?? lastAttempted?.id;
  const lastIdx =
    cursorAnchorId && !deactivatedIds.has(cursorAnchorId)
      ? remainingOrder.indexOf(cursorAnchorId)
      : -1;
  const nextCursor = lastIdx >= 0 ? lastIdx + 1 : 0;
  const nextTemplateCursor =
    groupsSent > 0 ? currentTemplateCursor + 1 : currentTemplateCursor;

  let status: "success" | "partial" | "failed" = "failed";
  if (groupsSent === 1 && groupsFailed === 0) status = "success";
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
    .update({
      last_run_at: nowIso,
      updated_at: nowIso,
      group_rotation_cursor: nextCursor,
      group_rotation_order: remainingOrder,
      template_rotation_cursor: nextTemplateCursor,
      template_rotation_order: orderedTemplateIds,
    })
    .eq("id", row.id);

  await supabase
    .from("automation_runs")
    .update({
      finished_at: nowIso,
      status,
      groups_targeted: groupsTargeted,
      groups_sent: groupsSent,
      groups_failed: groupsFailed,
      group_chat: sentGroupChat ?? lastAttempted?.name ?? lastAttempted?.whapi_id,
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
