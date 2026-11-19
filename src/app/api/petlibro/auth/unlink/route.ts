import { NextResponse } from "next/server";
import { unlinkPetlibroAccount } from "@/lib/petlibro";

export async function POST() {
  try {
    await unlinkPetlibroAccount();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "petlibro_unlink_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
