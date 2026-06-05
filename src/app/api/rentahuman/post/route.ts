// POST /api/rentahuman/post — publish (or dry-run preview) the DEAD DROP
// field-courier bounty on RentAHuman, fired from the dashboard button.
//
// Body: { dryRun?: boolean, price?: number, venue?: string }
//   dryRun:true (default)  → preview only. Posts NOTHING, charges nothing.
//   dryRun:false           → publishes a REAL public listing (summons a real
//                            human). Still $0 until a human is accepted, but it
//                            IS public — hence the explicit opt-in from the UI.
//
// On a real post we persist the returned bounty id (events table) so
// GET /api/rentahuman/status can find OURS again after a reload.
//
// SERVER ONLY: wraps src/lib/rentahuman.ts so RENTAHUMAN_API_KEY stays server-side.
import { NextRequest, NextResponse } from "next/server";
import { createBounty, handoffBounty } from "@/lib/rentahuman";
import { rememberPostedBounty } from "../_store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PostBody {
  dryRun?: boolean;
  price?: number;
  venue?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: PostBody = {};
  try {
    body = (await req.json()) as PostBody;
  } catch {
    // Empty/invalid body is fine — fall back to a safe dry-run default below.
    body = {};
  }

  // SAFE DEFAULT: if the caller doesn't explicitly say dryRun:false, we dry-run.
  const dryRun = body.dryRun !== false;
  const price = typeof body.price === "number" && body.price > 0 ? body.price : 5;
  const venue =
    typeof body.venue === "string" && body.venue.trim()
      ? body.venue.trim()
      : "Agentic AI SF Hackathon";

  const input = { ...handoffBounty({ price, venue }), dryRun };
  const result = await createBounty(input);

  // Persist the id ONLY on a real, successful post (a dry-run posts nothing).
  if (result.ok && !dryRun) {
    await rememberPostedBounty(result.bounty);
  }

  return NextResponse.json(
    {
      ok: result.ok,
      dryRun: result.dryRun,
      bounty: result.bounty ?? null,
      url: result.bounty?.url ?? (result.bounty?.id ? `https://rentahuman.ai/bounties/${result.bounty.id}` : null),
      error: result.error ?? null,
    },
    { status: result.ok ? 200 : 502 },
  );
}
