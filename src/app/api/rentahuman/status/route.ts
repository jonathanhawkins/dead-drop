// GET /api/rentahuman/status — the dashboard's "field courier" feed.
//
// Returns OUR current handoff bounty + the humans applying to it:
//   { posted: false }                                    // never posted
//   { posted: true, bounty: {...}, applications: [...] } // live listing
//
// We find OURS robustly by reading the bounty id we persisted at post time
// (events table, kind "rentahuman_bounty") and fetching it by id — never by
// scraping the public list, which also contains other agents' bounties.
//
// SERVER ONLY: the RENTAHUMAN_API_KEY lives in src/lib/rentahuman.ts and never
// reaches the browser; the client only ever hits this route.
import { NextResponse } from "next/server";
import { currentCourierStatus } from "../_store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const status = await currentCourierStatus();
    return NextResponse.json(status, { status: 200 });
  } catch (err) {
    // Degrade to "not posted" rather than 500 so the panel never hard-errors.
    console.error("[rentahuman/status] failed:", err);
    return NextResponse.json({ posted: false }, { status: 200 });
  }
}
