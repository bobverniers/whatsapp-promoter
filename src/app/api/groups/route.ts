import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkAuth } from "@/lib/auth";

export async function GET(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  const { data, error } = await supabase
    .from("external_groups")
    .select("*")
    .order("name", { ascending: true, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  const { id, tag, is_active } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (tag !== undefined) updates.tag = tag || null;
  if (is_active !== undefined) updates.is_active = is_active;

  const { data, error } = await supabase
    .from("external_groups")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
