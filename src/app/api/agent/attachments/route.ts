import { NextResponse } from "next/server";
import {
  AttachmentError,
  fileToAttachment,
  MAX_ATTACHMENTS,
  type ChatAttachment,
} from "@/lib/attachments";

/** Convert uploaded files (multipart field "file") into text attachments for the chat. */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
  if (!files.length) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (files.length > MAX_ATTACHMENTS) {
    return NextResponse.json(
      { error: `Attach up to ${MAX_ATTACHMENTS} files at a time` },
      { status: 400 },
    );
  }

  const attachments: ChatAttachment[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      const data = Buffer.from(await file.arrayBuffer());
      attachments.push(await fileToAttachment(file.name, file.type, data));
    } catch (e) {
      errors.push(e instanceof AttachmentError ? e.message : `${file.name}: couldn't read it`);
    }
  }
  if (!attachments.length) {
    return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  }
  return NextResponse.json({ attachments, errors });
}
