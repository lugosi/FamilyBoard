import { NextResponse } from "next/server";
import { linkPetlibroAccount } from "@/lib/petlibro";

type LinkBody = {
  email?: string;
  password?: string;
  region?: string;
};

export async function POST(request: Request) {
  let body: LinkBody;
  try {
    body = (await request.json()) as LinkBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim() || process.env.PETLIBRO_EMAIL?.trim();
  const password = body.password?.trim();
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }

  try {
    await linkPetlibroAccount({
      email,
      password,
      region: body.region?.trim() || process.env.PETLIBRO_REGION?.trim() || "US",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "petlibro_link_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
