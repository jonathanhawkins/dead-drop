"use client";

// The dashboard's single source of truth. Opens one RealtimeClient and folds
// every fact_log / messages / game_state change into React state, partitioned
// the way mission control renders it: three scoped fact columns, a message
// ticker, and the live game_state (beat + wearing).
//
// Reconciliation is the headline. When a fact_log row arrives with
// op "supersede" or "reconcile", we mark the matching earlier fact in the same
// (subject, scope) partition as `superseded` so the column can strike it through
// and flash the new line in. We also keep a short list of recent reconciliations
// for the banner.

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FactLogRow, FactOp, GameState, Scope } from "@/lib/types";
import {
  RealtimeClient,
  type ConnectionStatus,
  type MessageRow,
  type RealtimeChange,
} from "@/lib/realtime-client";

// A fact as the dashboard tracks it — derived from fact_log rows (we never need
// the `facts` table directly; every write mirrors to fact_log per the spec).
export interface DashboardFact {
  /** fact_log row id (stable React key). */
  logId: string;
  /** Underlying facts.id, when present — used to correlate updates. */
  factId?: string | null;
  scope: Scope;
  subject: string;
  content: string;
  op: FactOp;
  note?: string | null;
  createdAt: string;
  /** Set true when a later supersede/reconcile in the same partition lands. */
  superseded: boolean;
  /** True for the first ~2.5s after arrival so the UI can flash it in. */
  fresh: boolean;
}

export interface ReconcileEvent {
  id: string;
  scope: Scope;
  subject: string;
  newContent: string;
  note?: string | null;
  createdAt: string;
}

export interface TickerMessage {
  id: string;
  direction: "inbound" | "outbound" | "system";
  body: string;
  channel?: string | null;
  contentType?: string | null;
  createdAt: string;
}

export interface DashboardState {
  facts: DashboardFact[];
  reconciliations: ReconcileEvent[];
  messages: TickerMessage[];
  game: GameState | null;
}

// The cold-start snapshot the dashboard fetches on mount (GET /api/dashboard/
// snapshot). Facts arrive as raw `facts` rows (newest first); messages as loose
// rows. We fold them in under the realtime stream so the columns aren't empty on
// open, then realtime overlays live updates on top (deduped by id).
interface SnapshotFactRow {
  id: string;
  scope: Scope;
  subject: string;
  content?: string | null;
  status?: string | null;
  created_at?: string | null;
}

export interface DashboardSnapshot {
  game?: GameState | null;
  facts?: {
    world?: SnapshotFactRow[];
    handlerSecret?: SnapshotFactRow[];
    player?: SnapshotFactRow[];
  } | null;
  messages?: MessageRow[] | null;
}

type Action =
  | { kind: "fact"; row: FactLogRow }
  | { kind: "message"; row: MessageRow }
  | { kind: "game"; row: GameState }
  | { kind: "snapshot"; snapshot: DashboardSnapshot }
  | { kind: "unfresh"; logId: string };

const MAX_FACTS = 120;
const MAX_MESSAGES = 60;
const MAX_RECONCILES = 8;

function normDirection(d: MessageRow["direction"]): TickerMessage["direction"] {
  if (d === "inbound" || d === "outbound") return d;
  return "system";
}

function bodyOf(row: MessageRow): string {
  if (row.body && row.body.trim()) return row.body.trim();
  if (row.content_type === "image") return "[photo]";
  if (row.content_type) return `[${row.content_type}]`;
  return "[message]";
}

function reducer(state: DashboardState, action: Action): DashboardState {
  switch (action.kind) {
    case "fact": {
      const row = action.row;
      if (!row || !row.id) return state;

      const incoming: DashboardFact = {
        logId: row.id,
        factId: row.fact_id ?? null,
        scope: row.scope,
        subject: row.subject,
        content: row.content ?? "",
        op: row.op,
        note: row.note ?? null,
        createdAt: row.created_at ?? new Date().toISOString(),
        superseded: false,
        fresh: true,
      };

      // Dedupe — realtime can replay; never show the same log row twice.
      if (state.facts.some((f) => f.logId === incoming.logId)) return state;
      // Also dedupe against the cold-start snapshot: a seeded fact is keyed by its
      // facts.id, while its later realtime `assert` echo carries the same id in
      // `fact_id`. Suppress only the assert echo — supersede/reconcile/revise must
      // still pass through so they can strike the seeded card.
      if (
        row.op === "assert" &&
        incoming.factId &&
        state.facts.some((f) => f.factId === incoming.factId)
      ) {
        return state;
      }

      let facts = state.facts;
      let reconciliations = state.reconciliations;

      // A supersede/revise op identifies ONE specific contradicted fact — it
      // carries that fact's content (and its fact_id when present). Strike ONLY
      // that fact, NEVER the whole partition: other current beliefs (e.g. the
      // Pier 7 lie) must stay bright — that lie-vs-truth gap is the whole point.
      if (row.op === "supersede" || row.op === "revise") {
        incoming.superseded = true; // this card represents the now-old belief
        facts = facts.map((f) => {
          if (f.logId === incoming.logId || f.superseded) return f;
          if (f.scope !== incoming.scope || f.subject !== incoming.subject) return f;
          const sameContent = f.content.trim() === incoming.content.trim();
          const sameFact = incoming.factId != null && f.factId === incoming.factId;
          return sameContent || sameFact ? { ...f, superseded: true } : f;
        });
      }

      // The reconcile op is the NEW current belief — it strikes nothing, but it
      // drives the headline banner (it carries the new content + before→after note).
      if (row.op === "reconcile") {
        reconciliations = [
          {
            id: incoming.logId,
            scope: incoming.scope,
            subject: incoming.subject,
            newContent: incoming.content,
            note: incoming.note,
            createdAt: incoming.createdAt,
          },
          ...reconciliations,
        ].slice(0, MAX_RECONCILES);
      }

      // Newest first; cap the list so a long demo doesn't grow unbounded.
      facts = [incoming, ...facts].slice(0, MAX_FACTS);
      return { ...state, facts, reconciliations };
    }

    case "message": {
      const row = action.row;
      if (!row || !row.id) return state;
      if (state.messages.some((m) => m.id === row.id)) return state;
      const msg: TickerMessage = {
        id: row.id,
        direction: normDirection(row.direction),
        body: bodyOf(row),
        channel: row.channel ?? null,
        contentType: row.content_type ?? null,
        createdAt: row.created_at ?? new Date().toISOString(),
      };
      return { ...state, messages: [msg, ...state.messages].slice(0, MAX_MESSAGES) };
    }

    case "game": {
      const row = action.row;
      if (!row) return state;
      // Track the most-recently-updated session's state. If multiple sessions
      // stream we keep whichever ticked last (single-player demo in practice).
      if (state.game && state.game.session_id === row.session_id) {
        // Merge so a partial realtime row doesn't blank existing fields.
        return { ...state, game: { ...state.game, ...row } };
      }
      return { ...state, game: row };
    }

    case "snapshot": {
      const snap = action.snapshot;

      // ---- facts ----
      // Flatten the three scoped buckets into seeded DashboardFacts. Each is keyed
      // by its facts.id (logId === factId) so the realtime assert echo dedupes
      // against it. Pre-existing intel is NOT flashed (fresh:false). The snapshot
      // returns only `current` facts; mark anything else superseded defensively.
      const buckets: SnapshotFactRow[] = [
        ...(snap.facts?.world ?? []),
        ...(snap.facts?.handlerSecret ?? []),
        ...(snap.facts?.player ?? []),
      ];
      const seen = new Set(state.facts.map((f) => f.logId));
      const seenFactIds = new Set(
        state.facts.map((f) => f.factId).filter((x): x is string => Boolean(x)),
      );
      const seeded: DashboardFact[] = [];
      for (const r of buckets) {
        if (!r || !r.id) continue;
        if (seen.has(r.id) || seenFactIds.has(r.id)) continue; // already have it
        seen.add(r.id);
        seenFactIds.add(r.id);
        seeded.push({
          logId: r.id,
          factId: r.id,
          scope: r.scope,
          subject: r.subject,
          content: r.content ?? "",
          op: "assert",
          note: null,
          createdAt: r.created_at ?? new Date().toISOString(),
          superseded: r.status != null && r.status !== "current",
          fresh: false,
        });
      }
      // Keep newest-first ordering consistent with the realtime path.
      const facts =
        seeded.length > 0
          ? [...state.facts, ...seeded]
              .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
              .slice(0, MAX_FACTS)
          : state.facts;

      // ---- messages ----
      const haveMsg = new Set(state.messages.map((m) => m.id));
      const seededMsgs: TickerMessage[] = [];
      for (const row of snap.messages ?? []) {
        if (!row || !row.id || haveMsg.has(row.id)) continue;
        haveMsg.add(row.id);
        seededMsgs.push({
          id: row.id,
          direction: normDirection(row.direction),
          body: bodyOf(row),
          channel: row.channel ?? null,
          contentType: row.content_type ?? null,
          createdAt: row.created_at ?? new Date().toISOString(),
        });
      }
      const messages =
        seededMsgs.length > 0
          ? [...state.messages, ...seededMsgs]
              .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
              .slice(0, MAX_MESSAGES)
          : state.messages;

      // ---- game ----
      // Only seed game_state if realtime hasn't already provided one (realtime is
      // authoritative; the snapshot just fills the cold-start gap).
      const game = state.game ?? snap.game ?? null;

      return { ...state, facts, messages, game };
    }

    case "unfresh": {
      let changed = false;
      const facts = state.facts.map((f) => {
        if (f.logId === action.logId && f.fresh) {
          changed = true;
          return { ...f, fresh: false };
        }
        return f;
      });
      return changed ? { ...state, facts } : state;
    }

    default:
      return state;
  }
}

const EMPTY: DashboardState = {
  facts: [],
  reconciliations: [],
  messages: [],
  game: null,
};

export interface UseDashboardStateResult extends DashboardState {
  status: ConnectionStatus;
  factsByScope: Record<Scope, DashboardFact[]>;
}

/**
 * Subscribe to realtime and expose the folded mission-control state. Pass an
 * optional initial snapshot (e.g. seeded from /api/status) to avoid an empty
 * first paint.
 */
export function useDashboardState(initial?: Partial<DashboardState>): UseDashboardStateResult {
  const [state, dispatch] = useReducer(reducer, { ...EMPTY, ...initial });
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const clientRef = useRef<RealtimeClient | null>(null);

  useEffect(() => {
    const client = new RealtimeClient(
      {
        onChange: (change: RealtimeChange) => {
          if (change.table === "fact_log") dispatch({ kind: "fact", row: change.record });
          else if (change.table === "messages") dispatch({ kind: "message", row: change.record });
          else if (change.table === "game_state") dispatch({ kind: "game", row: change.record });
        },
        onStatus: (s) => setStatus(s),
      },
    );
    clientRef.current = client;
    client.connect();
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, []);

  // Cold-start hydration: pull the existing mission state once on mount so the
  // columns render immediately instead of waiting for the next realtime event.
  // The reducer folds this UNDER the live stream and dedupes by id, so a fact
  // present in both the snapshot and a later `change` won't render twice. The
  // browser calls our server route (which holds the service key) — no secret
  // touches the client. Failures are silent: realtime still drives the view.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dashboard/snapshot", { cache: "no-store" });
        if (!res.ok) return;
        const snapshot = (await res.json()) as DashboardSnapshot;
        if (!cancelled) dispatch({ kind: "snapshot", snapshot });
      } catch {
        /* offline / route not up yet — realtime carries the show */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Expire the "fresh" flash after a short window so flashes are momentary.
  useEffect(() => {
    const flashing = state.facts.filter((f) => f.fresh);
    if (flashing.length === 0) return;
    const timers = flashing.map((f) =>
      setTimeout(() => dispatch({ kind: "unfresh", logId: f.logId }), 2600),
    );
    return () => timers.forEach(clearTimeout);
  }, [state.facts]);

  const factsByScope = useMemo<Record<Scope, DashboardFact[]>>(() => {
    const buckets: Record<Scope, DashboardFact[]> = {
      world: [],
      player: [],
      "handler-secret": [],
    };
    for (const f of state.facts) buckets[f.scope]?.push(f);
    return buckets;
  }, [state.facts]);

  return { ...state, status, factsByScope };
}
