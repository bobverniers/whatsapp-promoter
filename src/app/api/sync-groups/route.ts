import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const WHAPI_BASE = "https://gate.whapi.cloud";
const PAGE_SIZE = 100;

interface WhapiGroup {
  id: string;
  name?: string;
}

interface WhapiGroupsResponse {
  groups: WhapiGroup[];
  total: number;
  count: number;
  offset: number;
}

async function fetchAllGroups(token: string): Promise<WhapiGroup[]> {
  const allGroups: WhapiGroup[] = [];
  let offset = 0;

  while (true) {
    const url = `${WHAPI_BASE}/groups?count=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Whapi returned ${res.status}: ${await res.text()}`);
    }

    const data: WhapiGroupsResponse = await res.json();
    allGroups.push(...data.groups);

    if (allGroups.length >= data.total) break;
    offset += PAGE_SIZE;
  }

  return allGroups;
}

export async function POST() {
  const token = process.env.WHAPI_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "WHAPI_TOKEN is not configured" },
      { status: 500 }
    );
  }

  try {
    const groups = await fetchAllGroups(token);

    if (groups.length === 0) {
      return NextResponse.json({ synced: 0, message: "No groups found on Whapi" });
    }

    const seen = new Map<string, { whapi_id: string; name: string | null }>();
    for (const g of groups) {
      seen.set(g.id, { whapi_id: g.id, name: g.name ?? null });
    }
    const rows = Array.from(seen.values());

    const { data, error } = await supabase
      .from("external_groups")
      .upsert(rows, { onConflict: "whapi_id", ignoreDuplicates: false })
      .select("whapi_id");

    if (error) {
      return NextResponse.json(
        { error: "Supabase upsert failed", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      synced: data?.length ?? 0,
      message: `Successfully synced ${data?.length ?? 0} groups from Whapi`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch groups from Whapi", details: message },
      { status: 502 }
    );
  }
}
