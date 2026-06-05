// Start a mission for a phone number (dashboard "Start Session" button).
//
// POST { phone, handle? } → loop.startSession (upsert player + open session +
// game_state + seed world facts), then fire the cinematic opening call WITHOUT
// blocking on its result (theatrical garnish; placeOpeningCall never throws and
// the text mission proceeds regardless). Returns the new ids.
import { NextRequest, NextResponse } from "next/server";
import { startSession } from "@/lib/loop";
import { placeOpeningCall } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StartBody {
  phone?: string;
  handle?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: StartBody = {};
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const handle = typeof body.handle === "string" && body.handle.trim() ? body.handle.trim() : undefined;
  if (!phone) {
    return NextResponse.json({ ok: false, error: "phone is required" }, { status: 400 });
  }

  try {
    const { player, session, state } = await startSession(phone, handle);

    // Fire-and-forget the opening call: kick it off, attach a catch so an async
    // rejection can't become an unhandled promise, but DON'T await it.
    void placeOpeningCall({ toPhone: phone, playerHandle: handle ?? player.handle ?? undefined })
      .then((r) => console.log(`[session/start] opening call: ${JSON.stringify(r)}`))
      .catch((err) => console.error("[session/start] opening call failed (ignored):", err));

    return NextResponse.json(
      {
        ok: true,
        playerId: player.id,
        sessionId: session.id,
        stateId: state.id,
        beat: state.beat,
        phone: player.phone,
        handle: player.handle ?? null,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[session/start] failed:", err);
    return NextResponse.json({ ok: false, error: "failed to start session" }, { status: 500 });
  }
}
