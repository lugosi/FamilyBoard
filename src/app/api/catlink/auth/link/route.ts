import { NextResponse } from "next/server";
import { linkCatlinkAccount } from "@/lib/catlink";

type LinkBody = {
  phone?: string;
  phoneIac?: string;
  password?: string;
};

export async function POST(request: Request) {
  let body: LinkBody;
  try {
    body = (await request.json()) as LinkBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const phone = body.phone?.trim() || process.env.CATLINK_PHONE?.trim();
  const password = body.password?.trim();
  if (!phone) {
    return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }

  try {
    await linkCatlinkAccount({
      phone,
      phoneIac: body.phoneIac?.trim() || process.env.CATLINK_PHONE_IAC?.trim() || "1",
      password,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "catlink_link_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
