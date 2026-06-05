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

type Action =
  | { kind: "fact"; row: FactLogRow }
  | { kind: "message"; row: MessageRow }
  | { kind: "game"; row: GameState }
  | { kind: "unfresh"; logId: string };

const MAX_FACTS = 120;
const MAX_MESSAGES = 60;
const MAX_RECONCILES = 8;

const SUPERSEDING_OPS: FactOp[] = ["supersede", "reconcile", "revise"];

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

      let facts = state.facts;
      let reconciliations = state.reconciliations;

      // A superseding op strikes through earlier *current* facts in the same
      // (subject, scope) partition. We don't strike the incoming row itself.
      if (SUPERSEDING_OPS.includes(row.op)) {
        facts = facts.map((f) =>
          f.scope === incoming.scope &&
          f.subject === incoming.subject &&
          f.logId !== incoming.logId &&
          !f.superseded
            ? { ...f, superseded: true }
            : f,
        );
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
