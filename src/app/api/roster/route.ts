// AGENT ROSTER — the operator's "who connected and played?" view.
//
// GET → { ok, totals, entries[] } where there is ONE entry per SESSION joined to
// its player + game_state + per-session message/photo counts. The dashboard's
// /roster page polls this every 5s and renders the table; clicking a row deep-
// links into mission control (/dashboard?session=<id>).
//
// READ-ONLY. SERVER ONLY — holds the service key via @/lib/butterbase; the browser
// fetches this route and never sees the secret. Phones are returned both masked
// (last-4, default display) and full (operator reveal); we never LOG a full phone.
//
// Efficiency: four batched table reads (sessions, players, game_state, then
// messages + proof events), then everything is grouped in memory by id — no
// per-row N+1 round-trips.
import { NextResponse } from "next/server";
import { dbSelect } from "@/lib/butterbase";
import { BEAT_ORDER, type Beat, type GameState, type Session } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Human-facing beat labels for the operator view. Keyed by the canonical Beat
// values in @/lib/types (the DB stores these internal names; the room-facing copy
// differs — e.g. courier_lie → "COVER PLANTED"). Mirrors the dashboard's
// BEAT_DISPLAY so the two surfaces read identically.
const BEAT_LABEL: Record<Beat, string> = {
  intro: "INTRO",
  cache_recovered: "CACHE RECOVERED",
  courier_lie: "COVER PLANTED",
  contradiction: "CONTRADICTION",
  finale_identify: "IDENTIFY",
  solve: "HANDOFF",
  signed_off: "SIGNED OFF",
};

// Beats that count as "completed" the mission (final handoff reached / signed off).
const COMPLETED_BEATS: ReadonlySet<Beat> = new Set<Beat>(["solve", "signed_off"]);

// players may not yet have the (new, nullable) `codename` column. We select * and
// read it defensively so the route works before and after the column lands.
interface PlayerRow {
  id: string;
  phone?: string | null;
  handle?: string | null;
  codename?: string | null;
  created_at?: string | null;
}

interface MessageRow {
  id: string;
  session_id?: string | null;
  created_at?: string | null;
}

interface EventRow {
  id: string;
  session_id?: string | null;
  kind?: string | null;
}

export interface RosterEntry {
  sessionId: string;
  playerId: string;
  /** codename || handle || phoneMasked — what the table shows first. */
  label: string;
  codename: string | null;
  handle: string | null;
  /** Full E.164 — operator "reveal" only; never the default display. */
  phoneFull: string | null;
  /** Last-4 masked form, e.g. "+1 •••‑7855". Default display. */
  phoneMasked: string | null;
  beat: Beat | null;
  /** 0..6 index into BEAT_ORDER, or -1 when there's no game_state yet. */
  beatIndex: number;
  beatLabel: string;
  /** Session lifecycle status (active / completed / aborted / …). */
  status: string;
  messageCount: number;
  photoCount: number;
  startedAt: string | null;
  /** Most recent of game_state.updated_at / last message / session start. */
  lastActiveAt: string | null;
}

export interface RosterTotals {
  players: number;
  sessions: number;
  active: number;
  completed: number;
}

export interface RosterResponse {
  ok: boolean;
  totals: RosterTotals;
  entries: RosterEntry[];
}

/** Mask to the last 4 digits: "+18186347855" → "+1 •••‑7855". Never logged. */
function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  const last4 = digits.slice(-4);
  // Country code = whatever precedes the final 10 digits (US numbers → "1").
  const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : "1";
  return `+${cc} •••‑${last4}`;
}

/** Pick the latest of a set of ISO timestamps (ignoring nullish). */
function latestIso(...times: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const t of times) {
    if (!t) continue;
    if (best === null || t > best) best = t;
  }
  return best;
}

export async function GET(): Promise<NextResponse> {
  try {
    // Batched reads — every row of each table, then grouped in memory. The demo
    // set is small (a roomful of operatives); a generous cap keeps this O(1) round
    // trips without risking an unbounded payload.
    const [sessions, players, gameStates, messages, events] = await Promise.all([
      dbSelect<Session>("sessions", { order: "created_at.desc", limit: 1000 }).catch((err) => {
        console.error("[roster] sessions read failed:", err);
        return [] as Session[];
      }),
      dbSelect<PlayerRow>("players", { limit: 1000 }).catch((err) => {
        console.error("[roster] players read failed:", err);
        return [] as PlayerRow[];
      }),
      dbSelect<GameState>("game_state", { limit: 1000 }).catch((err) => {
        console.error("[roster] game_state read failed:", err);
        return [] as GameState[];
      }),
      dbSelect<MessageRow>("messages", {
        select: "id,session_id,created_at",
        limit: 5000,
      }).catch((err) => {
        console.error("[roster] messages read failed:", err);
        return [] as MessageRow[];
      }),
      dbSelect<EventRow>("events", {
        select: "id,session_id,kind",
        limit: 5000,
      }).catch((err) => {
        console.error("[roster] events read failed:", err);
        return [] as EventRow[];
      }),
    ]);

    // ---- group lookups by id (no N+1) ----
    const playerById = new Map<string, PlayerRow>();
    for (const p of players) playerById.set(p.id, p);

    // game_state is one-per-session; if several exist for a session keep the
    // most-recently-updated (the live beat).
    const gameBySession = new Map<string, GameState>();
    for (const g of gameStates) {
      const prev = gameBySession.get(g.session_id);
      if (!prev || (g.updated_at ?? "") > (prev.updated_at ?? "")) {
        gameBySession.set(g.session_id, g);
      }
    }

    const msgCountBySession = new Map<string, number>();
    const lastMsgBySession = new Map<string, string>();
    for (const m of messages) {
      const sid = m.session_id;
      if (!sid) continue;
      msgCountBySession.set(sid, (msgCountBySession.get(sid) ?? 0) + 1);
      const prev = lastMsgBySession.get(sid);
      if (m.created_at && (!prev || m.created_at > prev)) lastMsgBySession.set(sid, m.created_at);
    }

    const photoCountBySession = new Map<string, number>();
    for (const e of events) {
      if (!e.session_id || e.kind !== "proof_photo") continue;
      photoCountBySession.set(e.session_id, (photoCountBySession.get(e.session_id) ?? 0) + 1);
    }

    // ---- build one entry per session ----
    const entries: RosterEntry[] = sessions.map((s) => {
      const player = playerById.get(s.player_id);
      const game = gameBySession.get(s.id) ?? null;
      const beat = (game?.beat as Beat | undefined) ?? null;
      const beatIndex = beat ? BEAT_ORDER.indexOf(beat) : -1;

      const codename = player?.codename?.trim() ? player.codename.trim() : null;
      const handle = player?.handle?.trim() ? player.handle.trim() : null;
      const phoneFull = player?.phone ?? null;
      const phoneMasked = maskPhone(phoneFull);
      const label = codename ?? handle ?? phoneMasked ?? "UNKNOWN";

      const messageCount = msgCountBySession.get(s.id) ?? 0;
      const photoCount = photoCountBySession.get(s.id) ?? 0;
      const lastActiveAt = latestIso(game?.updated_at, lastMsgBySession.get(s.id), s.started_at);

      return {
        sessionId: s.id,
        playerId: s.player_id,
        label,
        codename,
        handle,
        phoneFull,
        phoneMasked,
        beat,
        beatIndex,
        beatLabel: beat ? BEAT_LABEL[beat] : "—",
        status: s.status ?? "unknown",
        messageCount,
        photoCount,
        startedAt: s.started_at ?? null,
        lastActiveAt,
      };
    });

    // Newest activity first.
    entries.sort((a, b) => {
      const at = a.lastActiveAt ?? "";
      const bt = b.lastActiveAt ?? "";
      return at < bt ? 1 : at > bt ? -1 : 0;
    });

    // ---- totals ----
    // "completed" is derived from the BEAT (handoff/signed_off), not session.status,
    // because progress lives in game_state. "active" is the session lifecycle flag.
    const completed = entries.filter((e) => e.beat != null && COMPLETED_BEATS.has(e.beat)).length;
    const active = sessions.filter((s) => s.status === "active").length;
    const totals: RosterTotals = {
      players: players.length,
      sessions: sessions.length,
      active,
      completed,
    };

    return NextResponse.json({ ok: true, totals, entries } satisfies RosterResponse, {
      status: 200,
    });
  } catch (err) {
    console.error("[roster] failed:", err);
    return NextResponse.json(
      { ok: false, totals: { players: 0, sessions: 0, active: 0, completed: 0 }, entries: [] },
      { status: 500 },
    );
  }
}
