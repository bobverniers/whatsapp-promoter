import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkAuth } from "@/lib/auth";

const WHAPI_BASE = "https://gate.whapi.cloud";

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

  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const parsed = payload as { group_id?: unknown; message?: unknown };
  const groupId =
    typeof parsed.group_id === "string" && parsed.group_id.trim()
      ? parsed.group_id.trim()
      : null;
  if (!groupId) {
    return NextResponse.json({ error: "group_id is required" }, { status: 400 });
  }

  const message =
    typeof parsed.message === "string" && parsed.message.trim()
      ? parsed.message.trim()
      : null;
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const { data: group, error: groupErr } = await supabase
    .from("external_groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();

  if (groupErr) {
    return NextResponse.json(
      { error: "Failed to load group", details: groupErr.message },
      { status: 500 }
    );
  }

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 400 });
  }

  if (!group.is_active) {
    return NextResponse.json(
      { error: "Group is inactive; enable it before test send" },
      { status: 400 }
    );
  }

  const now = new Date();
  const body = message;

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

  return NextResponse.json({
    sent: true,
    test: true,
    group: {
      id: group.id,
      name: group.name,
      whapi_id: group.whapi_id,
      tag: group.tag,
    },
    preview: body,
  });
}
