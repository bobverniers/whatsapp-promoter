import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { password } = await request.json();
  const ok = password === process.env.ADMIN_PASSWORD;
  return NextResponse.json({ ok });
}
