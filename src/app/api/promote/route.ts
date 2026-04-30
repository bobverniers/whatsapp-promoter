import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkAuth } from "@/lib/auth";

const WHAPI_BASE = "https://gate.whapi.cloud";
const WARMUP_DAYS = 3;
const COOLDOWN_DAYS = 14;
const DAY_MS = 86_400_000;

export async function POST(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  const token = process.env.WHAPI_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "WHAPI_TOKEN is not configured" },
      { status: 500 }
    );
  }

  const now = new Date();
  const warmupCutoff = new Date(now.getTime() - WARMUP_DAYS * DAY_MS).toISOString();
  const cooldownCutoff = new Date(now.getTime() - COOLDOWN_DAYS * DAY_MS).toISOString();

  const { data: group, error: groupErr } = await supabase
    .from("external_groups")
    .select("*")
    .eq("is_active", true)
    .not("tag", "is", null)
    .lt("joined_at", warmupCutoff)
    .or(`last_promoted_at.is.null,last_promoted_at.lt.${cooldownCutoff}`)
    .order("last_promoted_at", { ascending: true, nullsFirst: true })
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (groupErr) {
    return NextResponse.json(
      { error: "Failed to query eligible groups", details: groupErr.message },
      { status: 500 }
    );
  }

  if (!group) {
    return NextResponse.json({ skipped: true, reason: "no eligible group" });
  }

  const { data: link, error: linkErr } = await supabase
    .from("community_links")
    .select("*")
    .eq("tag", group.tag)
    .maybeSingle();

  if (linkErr) {
    return NextResponse.json(
      { error: "Failed to load community link", details: linkErr.message },
      { status: 500 }
    );
  }

  if (!link) {
    return NextResponse.json({
      skipped: true,
      reason: `no link for tag ${group.tag}`,
    });
  }

  const { data: tmpl, error: tmplErr } = await supabase
    .from("promo_templates")
    .select("*")
    .eq("tag", group.tag)
    .order("use_count", { ascending: true })
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();

  if (tmplErr) {
    return NextResponse.json(
      { error: "Failed to load template", details: tmplErr.message },
      { status: 500 }
    );
  }

  if (!tmpl) {
    return NextResponse.json({
      skipped: true,
      reason: `no template for tag ${group.tag}`,
    });
  }

  const body = tmpl.content.replaceAll("{{link}}", link.current_url);

  const res = await fetch(`${WHAPI_BASE}/messages/text`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: group.whapi_id, body }),
  });

  if (!res.ok) {
    const details = await res.text();
    return NextResponse.json(
      { error: "Whapi send failed", status: res.status, details },
      { status: 502 }
    );
  }

  const nowIso = now.toISOString();

  const { error: groupUpdateErr } = await supabase
    .from("external_groups")
    .update({ last_promoted_at: nowIso })
    .eq("id", group.id);

  if (groupUpdateErr) {
    return NextResponse.json(
      {
        error: "Message sent but failed to update group bookkeeping",
        details: groupUpdateErr.message,
      },
      { status: 500 }
    );
  }

  const { error: tmplUpdateErr } = await supabase
    .from("promo_templates")
    .update({ use_count: tmpl.use_count + 1, last_used_at: nowIso })
    .eq("id", tmpl.id);

  if (tmplUpdateErr) {
    return NextResponse.json(
      {
        error: "Message sent but failed to update template bookkeeping",
        details: tmplUpdateErr.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    sent: true,
    group: {
      id: group.id,
      name: group.name,
      whapi_id: group.whapi_id,
      tag: group.tag,
    },
    template: { id: tmpl.id, use_count: tmpl.use_count + 1 },
    preview: body,
  });
}
