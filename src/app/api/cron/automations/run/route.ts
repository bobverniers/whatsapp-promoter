import { NextResponse } from "next/server";
import { runScheduledAutomations } from "@/lib/automation-runner";

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}

async function handleCron(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!secret || auth !== `Bearer ${secret}`) {
    return unauthorized();
  }

  try {
    const summary = await runScheduledAutomations();
    return NextResponse.json(summary);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "Cron automation failed unexpectedly", details: msg },
      { status: 500 }
    );
  }
}
