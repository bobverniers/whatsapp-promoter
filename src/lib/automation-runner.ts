import { supabase } from "@/lib/supabase";
import { looksLikeKickOrForbidden, sendWhapiText } from "@/lib/whapi-send";

export type AutomationConfigRow = {
  id: string;
  name: string;
  enabled: boolean;
  cron_expr: string;
  group_tags: string[] | null;
  group_include_ids: string[] | null;
  group_exclude_ids: string[] | null;
  template_ids: string[] | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AutomationRunSummary = {
  skipped?: boolean;
  reason?: string;
  runId: string | null;
  automationId: string | null;
  groupsTargeted: number;
  groupsSent: number;
  groupsFailed: number;
  templateId: string | null;
  status: "success" | "partial" | "failed";
  messages: string[];
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function buildMessageBody(templateContent: string, promoLink?: string): {
  ok: true;
  body: string;
} | { ok: false; error: string } {
  const hasPlaceholder = templateContent.includes("{{link}}");
  if (!hasPlaceholder)
    return { ok: true, body: templateContent };
  const link = promoLink?.trim();
  if (!link) {
    return {
      ok: false,
      error:
        'Template contains {{link}} but PROMO_LINK is not set in environment variables.',
    };
  }
  return {
    ok: true,
    body: templateContent.split("{{link}}").join(link),
  };
}

export async function fetchOrCreateAutomationConfig(): Promise<
  AutomationConfigRow
> {
  const first = await supabase
    .from("automation_configs")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (first.error) {
    throw new Error(first.error.message);
  }

  if (first.data) return first.data as AutomationConfigRow;

  const ins = await supabase
    .from("automation_configs")
    .insert({ name: "Default Automation", cron_expr: "*/5 * * * *" })
    .select("*")
    .single();

  if (ins.error) {
    throw new Error(ins.error.message);
  }

  return ins.data as AutomationConfigRow;
}

function pickRotatedTemplate<
  T extends { id: string; use_count: number; last_used_at: string | null },
>(pool: T[]): T | null {
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => {
    if (a.use_count !== b.use_count) return a.use_count - b.use_count;
    const ta = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
    const tb = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
    return ta - tb;
  })[0];
}

type TargetGroupRow = {
  id: string;
  whapi_id: string;
  name: string | null;
  is_active: boolean;
  tags: unknown;
  status_notes: string | null;
};

/**
 * Hybrid targeting: union of (groups matching any group_tags) and group_include_ids,
 * minus group_exclude_ids. Only active groups.
 */
function resolveTargetGroups(
  allGroups: TargetGroupRow[],
  config: AutomationConfigRow
): TargetGroupRow[] {
  const tagFilter = asStringArray(config.group_tags);
  const includeIds = new Set(asStringArray(config.group_include_ids));
  const excludeIds = new Set(asStringArray(config.group_exclude_ids));

  const byId = new Map(allGroups.map((g) => [g.id, g]));
  const selected = new Map<string, TargetGroupRow>();

  for (const g of allGroups) {
    if (!g.is_active) continue;
    const tags = asStringArray(g.tags);
    if (tagFilter.length === 0) continue;
    if (tags.some((t) => tagFilter.includes(t))) {
      selected.set(g.id, g);
    }
  }

  for (const id of includeIds) {
    const g = byId.get(id);
    if (g?.is_active) selected.set(id, g);
  }

  for (const id of excludeIds) {
    selected.delete(id);
  }

  return [...selected.values()];
}

export async function runAutomation(opts: {
  allowWhenDisabled: boolean;
}): Promise<AutomationRunSummary> {
  const messages: string[] = [];
  const token = process.env.WHAPI_TOKEN;

  let runId: string | null = null;
  let automationId: string | null = null;
  let groupsTargeted = 0;
  let groupsSent = 0;
  let groupsFailed = 0;
  let templateId: string | null = null;
  let finalStatus: "success" | "partial" | "failed" = "failed";

  try {
    const config = await fetchOrCreateAutomationConfig();

    automationId = config.id;

    if (!opts.allowWhenDisabled && !config.enabled) {
      return {
        skipped: true,
        reason: "Automation is disabled",
        runId: null,
        automationId: config.id,
        groupsTargeted: 0,
        groupsSent: 0,
        groupsFailed: 0,
        templateId: null,
        status: "success",
        messages: ["Skipped: automation disabled"],
      };
    }

    if (!token) {
      messages.push("WHAPI_TOKEN is not configured");
      return {
        runId: null,
        automationId: config.id,
        groupsTargeted: 0,
        groupsSent: 0,
        groupsFailed: 0,
        templateId: null,
        status: "failed",
        messages,
      };
    }

    const { data: allGroups, error: gErr } = await supabase
      .from("external_groups")
      .select("id, whapi_id, name, is_active, tags, status_notes");

    if (gErr) {
      messages.push(`Failed to load groups: ${gErr.message}`);
      return {
        runId: null,
        automationId: config.id,
        groupsTargeted: 0,
        groupsSent: 0,
        groupsFailed: 0,
        templateId: null,
        status: "failed",
        messages,
      };
    }

    const targets = resolveTargetGroups(allGroups ?? [], config);
    groupsTargeted = targets.length;

    const templateIdList = asStringArray(config.template_ids);
    if (templateIdList.length === 0) {
      messages.push("No templates selected in automation pool");
      const insRun = await supabase
        .from("automation_runs")
        .insert({
          automation_id: config.id,
          groups_targeted: groupsTargeted,
          groups_sent: 0,
          groups_failed: 0,
          status: "failed",
          finished_at: new Date().toISOString(),
          error_summary: messages.join("; "),
        })
        .select("id")
        .single();
      runId = insRun.data?.id ?? null;
      return {
        runId,
        automationId: config.id,
        groupsTargeted,
        groupsSent: 0,
        groupsFailed: 0,
        templateId: null,
        status: "failed",
        messages,
      };
    }

    const { data: tmplRows, error: tErr } = await supabase
      .from("promo_templates")
      .select("*")
      .in("id", templateIdList);

    if (tErr) {
      messages.push(`Failed to load templates: ${tErr.message}`);
      return {
        runId: null,
        automationId: config.id,
        groupsTargeted,
        groupsSent: 0,
        groupsFailed: 0,
        templateId: null,
        status: "failed",
        messages,
      };
    }

    const pool = (tmplRows ?? []).filter((t) => templateIdList.includes(t.id));
    const chosen = pickRotatedTemplate(pool);
    if (!chosen) {
      messages.push("None of the selected template IDs exist in the database");
      const insRun = await supabase
        .from("automation_runs")
        .insert({
          automation_id: config.id,
          groups_targeted: groupsTargeted,
          groups_sent: 0,
          groups_failed: 0,
          status: "failed",
          finished_at: new Date().toISOString(),
          error_summary: messages.join("; "),
        })
        .select("id")
        .single();
      runId = insRun.data?.id ?? null;
      return {
        runId,
        automationId: config.id,
        groupsTargeted,
        groupsSent: 0,
        groupsFailed: 0,
        templateId: null,
        status: "failed",
        messages,
      };
    }

    templateId = chosen.id;

    const bodyResult = buildMessageBody(
      chosen.content,
      process.env.PROMO_LINK
    );
    if (!bodyResult.ok) {
      messages.push(bodyResult.error);
      const insRun = await supabase
        .from("automation_runs")
        .insert({
          automation_id: config.id,
          groups_targeted: groupsTargeted,
          groups_sent: 0,
          groups_failed: 0,
          status: "failed",
          finished_at: new Date().toISOString(),
          error_summary: bodyResult.error,
        })
        .select("id")
        .single();
      runId = insRun.data?.id ?? null;
      return {
        runId,
        automationId: config.id,
        groupsTargeted,
        groupsSent: 0,
        groupsFailed: 0,
        templateId: chosen.id,
        status: "failed",
        messages,
      };
    }

    const body = bodyResult.body;
    const nowIso = new Date().toISOString();

    const { data: runInsert, error: runInsErr } = await supabase
      .from("automation_runs")
      .insert({
        automation_id: config.id,
        groups_targeted: groupsTargeted,
        groups_sent: 0,
        groups_failed: 0,
        status: "running",
      })
      .select("id")
      .single();

    if (runInsErr || !runInsert) {
      messages.push(`Failed to create run log: ${runInsErr?.message}`);
      return {
        runId: null,
        automationId: config.id,
        groupsTargeted,
        groupsSent: 0,
        groupsFailed: 0,
        templateId: chosen.id,
        status: "failed",
        messages,
      };
    }

    runId = runInsert.id;

    for (const g of targets) {
      const whapiId = g.whapi_id as string;
      const send = await sendWhapiText(token, whapiId, body);

      if (!send.ok) {
        groupsFailed += 1;
        const snippet = send.bodyText.slice(0, 200);
        messages.push(
          `Send failed for ${g.name ?? whapiId}: HTTP ${send.status} ${snippet}`
        );

        if (looksLikeKickOrForbidden(send.status)) {
          await supabase
            .from("external_groups")
            .update({
              is_active: false,
              status_notes: `Automation: Whapi ${send.status} at ${nowIso}`,
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

    if (groupsTargeted === 0) {
      finalStatus = "success";
    } else if (groupsSent === groupsTargeted) {
      finalStatus = "success";
    } else if (groupsSent === 0) {
      finalStatus = "failed";
    } else {
      finalStatus = "partial";
    }

    if (groupsSent > 0) {
      const newUse = (chosen.use_count ?? 0) + 1;
      await supabase
        .from("promo_templates")
        .update({
          use_count: newUse,
          last_used_at: nowIso,
        })
        .eq("id", chosen.id);
    }

    await supabase
      .from("automation_configs")
      .update({ last_run_at: nowIso, updated_at: nowIso })
      .eq("id", config.id);

    const errorSummary =
      groupsFailed > 0 ? messages.slice(-10).join("; ") : null;

    await supabase
      .from("automation_runs")
      .update({
        finished_at: nowIso,
        status: finalStatus,
        groups_sent: groupsSent,
        groups_failed: groupsFailed,
        error_summary: errorSummary,
      })
      .eq("id", runId);

    return {
      runId,
      automationId: config.id,
      groupsTargeted,
      groupsSent,
      groupsFailed,
      templateId: chosen.id,
      status: finalStatus,
      messages,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    messages.push(msg);
    if (runId) {
      await supabase
        .from("automation_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "failed",
          groups_sent: groupsSent,
          groups_failed: groupsFailed,
          error_summary: msg,
        })
        .eq("id", runId);
    }
    return {
      runId,
      automationId,
      groupsTargeted,
      groupsSent,
      groupsFailed,
      templateId,
      status: "failed",
      messages,
    };
  }
}
