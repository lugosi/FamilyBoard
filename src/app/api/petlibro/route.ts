import { NextResponse } from "next/server";
import { fetchPetlibroSnapshot, getPetlibroConfig } from "@/lib/petlibro";

export async function GET() {
  if (!(await getPetlibroConfig())) {
    return NextResponse.json(
      {
        error:
          "Link Petlibro from the board or set PETLIBRO_EMAIL and PETLIBRO_PASSWORD",
      },
      { status: 501 },
    );
  }
  try {
    const snapshot = await fetchPetlibroSnapshot();
    return NextResponse.json(snapshot);
  } catch (e) {
    const message = e instanceof Error ? e.message : "petlibro_error";
    const status = message === "petlibro_not_configured" ? 501 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
