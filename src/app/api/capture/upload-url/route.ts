// POST /api/capture/upload-url — mint a presigned Butterbase storage upload URL
// for the capture page's proof photo. The browser PUTs the file straight to the
// returned uploadUrl (matching Content-Type), then calls POST /api/capture with
// the objectId. Server-only: storageUploadUrl uses the service key.
//
// Request:  { filename: string; contentType: string; sizeBytes: number }
// Response: { ok: true; uploadUrl: string; objectId: string; objectKey?; expiresIn? }
//        |  { ok: false; error: string }   (HTTP 200 with ok:false on any failure)
import { NextResponse } from "next/server";
import { storageUploadUrl } from "@/lib/butterbase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UploadUrlBody {
  filename?: unknown;
  contentType?: unknown;
  sizeBytes?: unknown;
}

const MAX_BYTES = 30 * 1024 * 1024; // 30MB — phone photos (incl. HEIC) fit comfortably

export async function POST(req: Request): Promise<Response> {
  let body: UploadUrlBody;
  try {
    body = (await req.json()) as UploadUrlBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 200 });
  }

  const filename =
    typeof body.filename === "string" && body.filename.trim() ? body.filename.trim() : "proof.jpg";
  const contentType =
    typeof body.contentType === "string" && body.contentType.trim()
      ? body.contentType.trim()
      : "image/jpeg";
  const sizeBytes =
    typeof body.sizeBytes === "number" && Number.isFinite(body.sizeBytes) && body.sizeBytes > 0
      ? Math.floor(body.sizeBytes)
      : 0;

  if (!sizeBytes) {
    return NextResponse.json({ ok: false, error: "sizeBytes required" }, { status: 200 });
  }
  if (sizeBytes > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `file too large (max ${MAX_BYTES} bytes)` },
      { status: 200 },
    );
  }

  try {
    const target = await storageUploadUrl(filename, contentType, sizeBytes);
    return NextResponse.json(
      {
        ok: true,
        uploadUrl: target.uploadUrl,
        objectId: target.objectId,
        objectKey: target.objectKey,
        expiresIn: target.expiresIn,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[capture/upload-url] storageUploadUrl failed:", err);
    return NextResponse.json(
      { ok: false, error: "could not create upload URL" },
      { status: 200 },
    );
  }
}
