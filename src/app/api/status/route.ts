// Session status snapshot — what the dashboard (and the actor) poll for.
//
// GET ?sessionId=<id> → { state, player, facts:{world,player}, recentMessages }
// Read-only; degrades to nulls/empties so the dashboard never hard-errors on a
// missing or just-created session.
import { NextRequest, NextResponse } from "next/server";
import { dbSelect, dbSelectOne } from "@/lib/butterbase";
import { readPlayerMemory } from "@/lib/memory";
import type { GameState, Player } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MessageRow {
  id: string;
  direction: string;
  channel: string;
  content_type: string;
  body: string | null;
  created_at: string;
  meta?: unknown;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sessionId = req.nextUrl.searchParams.get("sessionId")?.trim() ?? "";
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: "sessionId is required" }, { status: 400 });
  }

  try {
    // game_state for the session (carries player_id we need for memory + player).
    const state = await dbSelectOne<GameState>("game_state", {
      filters: { session_id: `eq.${sessionId}` },
    });

    if (!state) {
      return NextResponse.json(
        {
          ok: true,
          state: null,
          player: null,
          facts: { world: [], player: [] },
          recentMessages: [],
        },
        { status: 200 },
      );
    }

    // Player + scoped memory + recent messages in parallel; each is independently
    // guarded so one slow/failed read doesn't sink the whole snapshot.
    const [player, facts, recentMessages] = await Promise.all([
      dbSelectOne<Player>("players", { filters: { id: `eq.${state.player_id}` } }).catch((err) => {
        console.error("[status] player read failed:", err);
        return null;
      }),
      readPlayerMemory(state.player_id).catch((err) => {
        console.error("[status] readPlayerMemory failed:", err);
        return { world: [], player: [] };
      }),
      dbSelect<MessageRow>("messages", {
        filters: { session_id: `eq.${sessionId}` },
        order: "created_at.desc",
        limit: 30,
      }).catch((err) => {
        console.error("[status] messages read failed:", err);
        return [] as MessageRow[];
      }),
    ]);

    return NextResponse.json(
      {
        ok: true,
        state,
        player,
        facts,
        // Oldest → newest for a natural ticker order.
        recentMessages: recentMessages.slice().reverse(),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[status] failed:", err);
    return NextResponse.json({ ok: false, error: "status failed" }, { status: 500 });
  }
}
