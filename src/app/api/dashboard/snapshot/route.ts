// Dashboard cold-start snapshot — the existing mission state the projector view
// needs to render IMMEDIATELY on open, before any realtime `change` arrives.
//
// The dashboard is otherwise realtime-only: it folds in fact_log / messages /
// game_state events as they stream, but anything written BEFORE it connected
// (world facts seeded at session start, the handler-secret intel, the player's
// beliefs, prior messages) never streams again — so without this the columns sit
// at "awaiting intel… 0". This route hands the client one consistent picture; the
// realtime feed then overlays live updates on top of it (deduped by id).
//
// GET → {
//   ok, sessionId, game, player,
//   facts: { world: Fact[], handlerSecret: Fact[], player: Fact[] },
//   messages: MessageRow[]   // oldest → newest, ~30
// }
//
// Read-only; degrades to nulls/empties so the dashboard never hard-errors on a
// fresh/empty DB. SERVER ONLY — holds the service key via @/lib/butterbase; the
// browser fetches this route and never sees the secret.
import { NextResponse } from "next/server";
import { dbSelect, dbSelectOne } from "@/lib/butterbase";
import type { Fact, GameState, Player, Session } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Loosely-typed message row — mirrors @/lib/realtime-client MessageRow so the
// dashboard's `message` reducer consumes snapshot rows identically to live ones.
interface MessageRow {
  id: string;
  session_id?: string | null;
  player_id?: string | null;
  direction?: string | null;
  channel?: string | null;
  content_type?: string | null;
  body?: string | null;
  meta?: unknown;
  created_at: string;
}

// Current facts for one (subject, scope) partition, newest first. Each read is
// independently guarded so one failure doesn't sink the whole snapshot.
async function currentFacts(subject: string, scope: Fact["scope"]): Promise<Fact[]> {
  try {
    return await dbSelect<Fact>("facts", {
      filters: {
        subject: `eq.${subject}`,
        scope: `eq.${scope}`,
        status: "eq.current",
      },
      order: "created_at.desc",
    });
  } catch (err) {
    console.error(`[snapshot] facts ${scope}/${subject} read failed:`, err);
    return [];
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    // World truth + the Handler's private intel are subject = "world" and don't
    // depend on a session — fetch them regardless of whether one is active.
    const [world, handlerSecret] = await Promise.all([
      currentFacts("world", "world"),
      currentFacts("world", "handler-secret"),
    ]);

    // The active mission, if any: newest active session → its game_state, player,
    // that player's current beliefs, and recent traffic. The dashboard tracks the
    // most-recently-updated session, so the newest active one is the right pick.
    const session = await dbSelectOne<Session>("sessions", {
      filters: { status: "eq.active" },
      order: "created_at.desc",
    }).catch((err) => {
      console.error("[snapshot] active session read failed:", err);
      return null;
    });

    if (!session) {
      return NextResponse.json(
        {
          ok: true,
          sessionId: null,
          game: null,
          player: null,
          facts: { world, handlerSecret, player: [] as Fact[] },
          messages: [] as MessageRow[],
        },
        { status: 200 },
      );
    }

    const [game, player, playerFacts, messages] = await Promise.all([
      dbSelectOne<GameState>("game_state", {
        filters: { session_id: `eq.${session.id}` },
      }).catch((err) => {
        console.error("[snapshot] game_state read failed:", err);
        return null;
      }),
      dbSelectOne<Player>("players", {
        filters: { id: `eq.${session.player_id}` },
      }).catch((err) => {
        console.error("[snapshot] player read failed:", err);
        return null;
      }),
      currentFacts(session.player_id, "player"),
      dbSelect<MessageRow>("messages", {
        filters: { session_id: `eq.${session.id}` },
        order: "created_at.desc",
        limit: 30,
      }).catch((err) => {
        console.error("[snapshot] messages read failed:", err);
        return [] as MessageRow[];
      }),
    ]);

    return NextResponse.json(
      {
        ok: true,
        sessionId: session.id,
        game,
        player,
        facts: { world, handlerSecret, player: playerFacts },
        // Oldest → newest for a natural ticker order (matches /api/status).
        messages: messages.slice().reverse(),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[snapshot] failed:", err);
    return NextResponse.json({ ok: false, error: "snapshot failed" }, { status: 500 });
  }
}
