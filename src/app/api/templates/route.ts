import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkAuth } from "@/lib/auth";

export async function GET(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  const { data, error } = await supabase
    .from("promo_templates")
    .select("*")
    .order("use_count", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  const { content } = await request.json();

  if (!content) {
    return NextResponse.json(
      { error: "content is required" },
      { status: 400 }
    );
  }

  const { count, error: countError } = await supabase
    .from("promo_templates")
    .select("id", { count: "exact", head: true })
    .is("tag", null);

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  if ((count ?? 0) >= 15) {
    return NextResponse.json(
      { error: "Global template limit reached (15)" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("promo_templates")
    .insert({ content, tag: null })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  const { id, content } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (content !== undefined) updates.content = content;
  updates.tag = null;

  const { data, error } = await supabase
    .from("promo_templates")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  const { id } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("promo_templates")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
