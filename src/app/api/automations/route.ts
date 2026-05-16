import { NextResponse } from "next/server";
import {
  canonicalIntervalMinutes,
  normalizeIntervalMode,
} from "@/lib/automation-intervals";
import { checkAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { normalizeTags } from "@/lib/tags";
import { normalizeUuidList } from "@/lib/uuids";

function asPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return fallback;
}

function normalizeScheduleTz(value: unknown): string {
  if (typeof value === "string") {
    const t = value.trim();
    if (t) return t;
  }
  return "UTC";
}

function coerceInt(
  val: unknown,
  min: number,
  max: number
): number | undefined {
  if (val === undefined || val === null) return undefined;
  const raw =
    typeof val === "number" && Number.isFinite(val)
      ? Math.floor(val)
      : typeof val === "string" && val.trim()
        ? Math.floor(Number(val))
        : NaN;
  if (!Number.isFinite(raw) || raw < min || raw > max) return undefined;
  return raw;
}

function normalizeActiveHourWindow(
  activeStart: unknown,
  activeEndExclusive: unknown
): { ok: false; error: string } | { ok: true; start: null; endExclusive: null } | { ok: true; start: number; endExclusive: number } {
  const unsetStart = activeStart === undefined || activeStart === null;
  const unsetEnd = activeEndExclusive === undefined || activeEndExclusive === null;

  if (unsetStart && unsetEnd) {
    return { ok: true, start: null, endExclusive: null };
  }

  const start = coerceInt(activeStart, 0, 23);
  const endExclusive = coerceInt(activeEndExclusive, 1, 24);

  if (start === undefined || endExclusive === undefined) {
    return {
      ok: false,
      error:
        "active_start_hour (0–23) and active_end_exclusive (1–24) must both be valid numbers when restricting hours.",
    };
  }

  if (start >= endExclusive) {
    return {
      ok: false,
      error:
        "active_start_hour must be less than active_end_exclusive (exclusive end uses wall-clock hour).",
    };
  }

  return { ok: true, start, endExclusive };
}

export async function GET(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  const [automationsRes, groupsRes, templatesRes, logsRes] = await Promise.all([
    supabase
      .from("automation_configs")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("external_groups")
      .select("id, whapi_id, name, is_active, tags")
      .order("name", { ascending: true, nullsFirst: false }),
    supabase
      .from("promo_templates")
      .select("id, content, use_count, last_used_at, tags")
      .order("use_count", { ascending: true }),
    supabase
      .from("automation_runs")
      .select(
        "id, automation_id, automation_name, started_at, finished_at, status, groups_targeted, groups_sent, groups_failed, group_chat, message_sent, error_summary"
      )
      .order("started_at", { ascending: false })
      .limit(100),
  ]);

  const firstErr =
    automationsRes.error ??
    groupsRes.error ??
    templatesRes.error ??
    logsRes.error;
  if (firstErr) {
    return NextResponse.json(
      { error: "Failed to load automations page", details: firstErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    automations: automationsRes.data ?? [],
    groups: groupsRes.data ?? [],
    templates: templatesRes.data ?? [],
    logs: logsRes.data ?? [],
  });
}

export async function POST(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : "New automation";
  const interval_mode = normalizeIntervalMode(body.interval_mode);
  const interval_minutes = canonicalIntervalMinutes(interval_mode);
  const group_ids = normalizeUuidList(body.group_ids);
  const template_ids = normalizeUuidList(body.template_ids);
  const group_tags = normalizeTags(body.group_tags);
  const template_tags = normalizeTags(body.template_tags);
  const enabled = typeof body.enabled === "boolean" ? body.enabled : false;
  const schedule_tz = normalizeScheduleTz(body.schedule_tz);
  const win = normalizeActiveHourWindow(
    body.active_start_hour,
    body.active_end_exclusive
  );
  if (!win.ok) {
    return NextResponse.json({ error: win.error }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("automation_configs")
    .insert({
      name,
      enabled,
      interval_mode,
      interval_minutes,
      group_ids,
      group_rotation_cursor: 0,
      template_ids,
      template_rotation_cursor: 0,
      group_tags,
      template_tags,
      schedule_tz,
      active_start_hour: win.start,
      active_end_exclusive: win.endExclusive,
      updated_at: nowIso,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to create automation", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
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

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim();
  }
  if (typeof body.enabled === "boolean") {
    updates.enabled = body.enabled;
  }
  if ("schedule_tz" in body) {
    updates.schedule_tz = normalizeScheduleTz(body.schedule_tz);
  }
  if (
    Object.prototype.hasOwnProperty.call(body, "active_start_hour") ||
    Object.prototype.hasOwnProperty.call(body, "active_end_exclusive")
  ) {
    const win = normalizeActiveHourWindow(
      body.active_start_hour,
      body.active_end_exclusive
    );
    if (!win.ok) {
      return NextResponse.json({ error: win.error }, { status: 400 });
    }
    updates.active_start_hour = win.start;
    updates.active_end_exclusive = win.endExclusive;
  }
  if (body.interval_minutes !== undefined) {
    updates.interval_minutes = asPositiveInt(body.interval_minutes, 15);
  }
  if (body.interval_mode !== undefined) {
    const nextMode = normalizeIntervalMode(body.interval_mode);
    updates.interval_mode = nextMode;
    updates.interval_minutes = canonicalIntervalMinutes(nextMode);
  }
  if (body.group_ids !== undefined) {
    updates.group_ids = normalizeUuidList(body.group_ids);
    updates.group_rotation_cursor = 0;
  }
  if (body.group_tags !== undefined) {
    updates.group_tags = normalizeTags(body.group_tags);
    updates.group_rotation_cursor = 0;
  }
  if (body.template_ids !== undefined) {
    updates.template_ids = normalizeUuidList(body.template_ids);
    updates.template_rotation_cursor = 0;
  }
  if (body.template_tags !== undefined) {
    updates.template_tags = normalizeTags(body.template_tags);
    updates.template_rotation_cursor = 0;
  }

  const { data, error } = await supabase
    .from("automation_configs")
    .update(updates)
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to update automation", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("automation_configs")
    .update({ deleted_at: nowIso, enabled: false, updated_at: nowIso })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete automation", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id: data.id });
}
