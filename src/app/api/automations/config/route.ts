import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  fetchOrCreateAutomationConfig,
  type AutomationConfigRow,
} from "@/lib/automation-runner";
import { normalizeTags } from "@/lib/tags";
import { normalizeUuidList } from "@/lib/uuids";
import { normalizeCronExpr } from "@/lib/cron-intervals";

export async function GET(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  try {
    const config = await fetchOrCreateAutomationConfig();

    const [groupsRes, templatesRes, runsRes] = await Promise.all([
      supabase
        .from("external_groups")
        .select("id, whapi_id, name, is_active, tags, last_promoted_at")
        .order("name", { ascending: true, nullsFirst: false }),
      supabase
        .from("promo_templates")
        .select("*")
        .order("use_count", { ascending: true }),
      supabase
        .from("automation_runs")
        .select("*")
        .eq("automation_id", config.id)
        .order("started_at", { ascending: false })
        .limit(15),
    ]);

    return NextResponse.json({
      config,
      groups: groupsRes.data ?? [],
      templates: templatesRes.data ?? [],
      recentRuns: runsRes.data ?? [],
      errors: {
        groups: groupsRes.error?.message,
        templates: templatesRes.error?.message,
        runs: runsRes.error?.message,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to load automation config", details: msg },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  try {
    const existing = await fetchOrCreateAutomationConfig();
    if (!existing) {
      return NextResponse.json(
        { error: "No automation configuration" },
        { status: 500 }
      );
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if (typeof body.enabled === "boolean") {
      updates.enabled = body.enabled;
    }
    if (typeof body.cron_expr === "string" && body.cron_expr.trim()) {
      updates.cron_expr = normalizeCronExpr(body.cron_expr);
    }
    if (body.group_tags !== undefined) {
      updates.group_tags = normalizeTags(body.group_tags);
    }
    if (body.group_include_ids !== undefined) {
      updates.group_include_ids = normalizeUuidList(body.group_include_ids);
    }
    if (body.group_exclude_ids !== undefined) {
      updates.group_exclude_ids = normalizeUuidList(body.group_exclude_ids);
    }
    if (body.template_ids !== undefined) {
      updates.template_ids = normalizeUuidList(body.template_ids);
    }

    const { data, error } = await supabase
      .from("automation_configs")
      .update(updates)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Update failed", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data as AutomationConfigRow);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to update automation config", details: msg },
      { status: 500 }
    );
  }
}
