import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";

export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = checkAuth(request);
  if (denied) return denied;

  return NextResponse.json(
    {
      error:
        "Run-now is disabled on Automations page. Use enabled automations + scheduler.",
    },
    { status: 410 }
  );
}
