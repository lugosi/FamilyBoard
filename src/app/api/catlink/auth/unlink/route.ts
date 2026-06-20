import { NextResponse } from "next/server";
import { unlinkCatlinkAccount } from "@/lib/catlink";

export async function POST() {
  await unlinkCatlinkAccount();
  return NextResponse.json({ ok: true });
}
