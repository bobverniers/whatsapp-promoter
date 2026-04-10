import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkAuth } from "@/lib/auth";

export async function GET(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  const { data, error } = await supabase
    .from("community_links")
    .select("*")
    .order("tag");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  const { tag, current_url } = await request.json();

  if (!tag || !current_url) {
    return NextResponse.json(
      { error: "tag and current_url are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("community_links")
    .insert({ tag, current_url })
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

  const { id, current_url } = await request.json();

  if (!id || !current_url) {
    return NextResponse.json(
      { error: "id and current_url are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("community_links")
    .update({ current_url, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
