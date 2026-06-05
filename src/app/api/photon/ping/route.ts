// Ops pre-flight: hit this to confirm the Spectrum SDK can initialize/authenticate
// in the real server runtime (where spectrum-ts loads as proper ESM).
//   curl http://localhost:4317/api/photon/ping
// Returns { ok, detail }. ok:false with "MOCK_PHOTON is on" means the server is
// still mocked (restart with MOCK_PHOTON=false to test the real SDK).
import { NextResponse } from "next/server";
import { pingPhoton } from "@/lib/photon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const result = await pingPhoton();
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
