// Manual override — the demo safety net. A trusted operator (the dashboard
// control bar) can force the story forward when a live phone hiccups.
//
// POST { sessionId, action:"advance"|"set_beat"|"mark_verified", beat?, token }
//   - token MUST equal env.dashboard.overrideToken.
//   - advance       → move game_state.beat to the next beat in BEAT_ORDER.
//   - set_beat      → jump game_state.beat to `beat` (must be a valid Beat).
//   - mark_verified → flip override_advance=true so the NEXT inbound auto-advances
//                     one beat (lets the operator unblock a stuck proof step
//                     without forcing the exact beat).
// Every override writes a human-readable note into fact_log so it shows on the
// dashboard's feed, and returns the updated state.
import { NextRequest, NextResponse } from "next/server";
import { dbInsert, dbSelectOne, dbUpdate } from "@/lib/butterbase";
import { env } from "@/lib/env";
import { BEAT_ORDER } from "@/lib/types";
import type { Beat, GameState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "advance" | "set_beat" | "mark_verified";

interface OverrideBody {
  sessionId?: string;
  action?: Action;
  beat?: string;
  token?: string;
}

function isBeat(v: string | undefined): v is Beat {
  return !!v && (BEAT_ORDER as readonly string[]).includes(v);
}

function nextInOrder(beat: Beat): Beat {
  const i = BEAT_ORDER.indexOf(beat);
  if (i < 0) return beat;
  return BEAT_ORDER[Math.min(i + 1, BEAT_ORDER.length - 1)];
}

/** Mirror the override into fact_log so the dashboard surfaces it. Best-effort. */
async function logOverride(
  state: GameState,
  op: "advance" | "set_beat" | "mark_verified",
  note: string,
): Promise<void> {
  try {
    await dbInsert("fact_log", {
      fact_id: null,
      op: "reconcile", // fact_log.op is constrained to FactOp; "reconcile" reads as an operator action on the feed.
      scope: "world",
      subject: "world",
      content: `OVERRIDE (${op})`,
      note,
      session_id: state.session_id,
    });
  } catch (err) {
    console.error("[override] fact_log mirror failed (continuing):", err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: OverrideBody = {};
  try {
    body = (await req.json()) as OverrideBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  // Auth: constant-time-ish equality is overkill here; a plain check is fine for
  // a demo override token, but reject empty tokens outright.
  if (!body.token || body.token !== env.dashboard.overrideToken) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: "sessionId is required" }, { status: 400 });
  }
  const action: Action = body.action ?? "advance";

  // Load the current game_state for this session.
  let state: GameState | null;
  try {
    state = await dbSelectOne<GameState>("game_state", {
      filters: { session_id: `eq.${sessionId}` },
    });
  } catch (err) {
    console.error("[override] state lookup failed:", err);
    return NextResponse.json({ ok: false, error: "state lookup failed" }, { status: 500 });
  }
  if (!state) {
    return NextResponse.json({ ok: false, error: "no game_state for session" }, { status: 404 });
  }

  try {
    let patch: Partial<GameState> = { updated_at: new Date().toISOString() } as Partial<GameState>;
    let note = "";

    switch (action) {
      case "advance": {
        const target = nextInOrder(state.beat);
        patch = { ...patch, beat: target, override_advance: false };
        note = `operator advanced beat: ${state.beat} → ${target}`;
        break;
      }
      case "set_beat": {
        if (!isBeat(body.beat)) {
          return NextResponse.json(
            { ok: false, error: `invalid beat "${body.beat}"` },
            { status: 400 },
          );
        }
        patch = { ...patch, beat: body.beat, override_advance: false };
        note = `operator set beat: ${state.beat} → ${body.beat}`;
        break;
      }
      case "mark_verified": {
        // Stage an auto-advance on the next inbound rather than forcing a beat —
        // the operator confirms proof they saw in person, the loop moves on.
        patch = { ...patch, override_advance: true };
        note = `operator marked verified at beat ${state.beat} (next inbound auto-advances)`;
        break;
      }
      default:
        return NextResponse.json({ ok: false, error: `unknown action "${action}"` }, { status: 400 });
    }

    const updated = await dbUpdate<GameState>("game_state", state.id, patch);
    await logOverride(updated, action, note);

    return NextResponse.json({ ok: true, action, note, state: updated }, { status: 200 });
  } catch (err) {
    console.error("[override] apply failed:", err);
    return NextResponse.json({ ok: false, error: "override failed" }, { status: 500 });
  }
}
