import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";
import { runAutomation } from "@/lib/automation-runner";

export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  try {
    const summary = await runAutomation({ allowWhenDisabled: true });
    return NextResponse.json(summary);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "Run failed unexpectedly", details: msg },
      { status: 500 }
    );
  }
}
