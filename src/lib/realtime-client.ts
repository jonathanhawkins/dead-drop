// Browser WebSocket helper for the DEAD DROP dashboard (CLIENT ONLY).
//
// Connects to the Butterbase realtime gateway and subscribes to the three
// tables that drive mission control: `fact_log` (scoped-memory writes, the
// star of the show), `messages` (the live ticker), and `game_state` (beat +
// wearing). It auto-reconnects with backoff, replays its subscriptions on every
// (re)connect, and fans every change out to a single onChange callback.
//
// Contract (from BUILD_SPEC §3):
//   wss://api.butterbase.ai/v1/{appId}/realtime?token={NEXT_PUBLIC_..._TOKEN}
//   send    -> {type:"subscribe", table}
//   receive -> {type:"change", table, op:"INSERT"|"UPDATE"|"DELETE", record, old_record}
//             plus {type:"connected"|"subscribed"|"heartbeat"|"error"}
//
// This file reads NEXT_PUBLIC_* only — never the server env module.

import type { FactLogRow, GameState } from "./types";

// Tables we listen to. Keep this list in sync with the dashboard's reducers.
export const REALTIME_TABLES = ["fact_log", "messages", "game_state"] as const;
export type RealtimeTable = (typeof REALTIME_TABLES)[number];

export type RealtimeOp = "INSERT" | "UPDATE" | "DELETE";

// A message row, loosely typed — the dashboard ticker only needs these fields,
// and the realtime payload is whatever the DB row looks like.
export interface MessageRow {
  id: string;
  session_id?: string | null;
  player_id?: string | null;
  direction?: "inbound" | "outbound" | string | null;
  channel?: string | null;
  content_type?: string | null;
  body?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
}

// Discriminated union so the dashboard can narrow `record` by `table`.
export type RealtimeChange =
  | { table: "fact_log"; op: RealtimeOp; record: FactLogRow; oldRecord?: Partial<FactLogRow> | null }
  | { table: "messages"; op: RealtimeOp; record: MessageRow; oldRecord?: Partial<MessageRow> | null }
  | { table: "game_state"; op: RealtimeOp; record: GameState; oldRecord?: Partial<GameState> | null };

export type ConnectionStatus = "connecting" | "open" | "closed" | "error";

export interface RealtimeHandlers {
  onChange: (change: RealtimeChange) => void;
  onStatus?: (status: ConnectionStatus) => void;
}

export interface RealtimeClientOptions {
  appId?: string;
  token?: string;
  tables?: readonly RealtimeTable[];
}

// Raw shape off the wire — untyped on purpose; we validate fields defensively.
/* eslint-disable @typescript-eslint/no-explicit-any */
interface RawEnvelope {
  type?: string;
  table?: string;
  op?: string;
  record?: any;
  old_record?: any;
  [k: string]: any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function publicEnv(name: string, fallback = ""): string {
  // Next inlines process.env.NEXT_PUBLIC_* at build time for client bundles.
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

/**
 * A resilient realtime subscription. Construct it, call `.connect()` once, and
 * `.close()` on teardown. Safe to call methods before/after connect; everything
 * no-ops outside the browser so it can be imported anywhere.
 */
export class RealtimeClient {
  private ws: WebSocket | null = null;
  private readonly appId: string;
  private readonly token: string;
  private readonly tables: readonly RealtimeTable[];
  private readonly handlers: RealtimeHandlers;

  private closedByUser = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatWatchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(handlers: RealtimeHandlers, opts: RealtimeClientOptions = {}) {
    this.handlers = handlers;
    this.appId = opts.appId ?? publicEnv("NEXT_PUBLIC_BUTTERBASE_APP_ID");
    this.token = opts.token ?? publicEnv("NEXT_PUBLIC_BUTTERBASE_REALTIME_TOKEN");
    this.tables = opts.tables ?? REALTIME_TABLES;
  }

  /** True when we have enough config to even attempt a connection. */
  get configured(): boolean {
    return Boolean(this.appId && this.token);
  }

  private url(): string {
    return `wss://api.butterbase.ai/v1/${this.appId}/realtime?token=${encodeURIComponent(this.token)}`;
  }

  private setStatus(status: ConnectionStatus): void {
    try {
      this.handlers.onStatus?.(status);
    } catch (err) {
      console.error("[realtime] onStatus handler threw", err);
    }
  }

  connect(): void {
    if (typeof window === "undefined") return; // SSR / build: no-op
    if (!this.configured) {
      console.warn(
        "[realtime] missing NEXT_PUBLIC_BUTTERBASE_APP_ID or NEXT_PUBLIC_BUTTERBASE_REALTIME_TOKEN — running disconnected",
      );
      this.setStatus("error");
      return;
    }
    this.closedByUser = false;
    this.openSocket();
  }

  private openSocket(): void {
    this.clearReconnectTimer();
    this.setStatus("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch (err) {
      console.error("[realtime] WebSocket construction failed", err);
      this.setStatus("error");
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("open");
      // Subscribe AFTER the server's `connected` frame (see handleRaw) — NOT here.
      // The gateway drops subscriptions sent before it finishes the handshake, so
      // subscribing on raw `open` silently yields no `subscribed` ack and no events.
      this.armHeartbeatWatchdog();
    };

    ws.onmessage = (ev: MessageEvent) => {
      this.armHeartbeatWatchdog(); // any traffic counts as a heartbeat
      this.handleRaw(ev.data);
    };

    ws.onerror = (ev: Event) => {
      // Browsers give almost no detail here; log and let onclose drive reconnect.
      console.error("[realtime] socket error", ev);
      this.setStatus("error");
    };

    ws.onclose = () => {
      this.ws = null;
      this.clearHeartbeatWatchdog();
      if (this.closedByUser) {
        this.setStatus("closed");
        return;
      }
      this.setStatus("closed");
      this.scheduleReconnect();
    };
  }

  private subscribeAll(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const table of this.tables) {
      try {
        this.ws.send(JSON.stringify({ type: "subscribe", table }));
      } catch (err) {
        console.error(`[realtime] failed to subscribe ${table}`, err);
      }
    }
  }

  private handleRaw(data: unknown): void {
    if (typeof data !== "string") return;
    let env: RawEnvelope;
    try {
      env = JSON.parse(data) as RawEnvelope;
    } catch (err) {
      console.warn("[realtime] non-JSON frame ignored", err);
      return;
    }

    switch (env.type) {
      case "change":
        this.emitChange(env);
        return;
      case "connected":
        // Handshake done — NOW it's safe to (re)subscribe. Doing this on socket
        // open races the gateway and the subscription is silently dropped.
        this.subscribeAll();
        return;
      case "subscribed":
      case "heartbeat":
        return; // lifecycle/keepalive — nothing to fan out
      case "error":
        console.warn("[realtime] server error frame", env);
        return;
      default:
        // Some gateways omit `type` on data frames; if it carries a table+record
        // treat it as a change rather than dropping a real event.
        if (env.table && env.record) this.emitChange(env);
        return;
    }
  }

  private emitChange(env: RawEnvelope): void {
    const table = env.table;
    if (table !== "fact_log" && table !== "messages" && table !== "game_state") return;
    const op = (env.op ?? "INSERT").toUpperCase();
    const normalizedOp: RealtimeOp =
      op === "UPDATE" || op === "DELETE" ? (op as RealtimeOp) : "INSERT";
    const record = env.record;
    if (record == null || typeof record !== "object") return;

    // Cast is safe: the dashboard reducers read fields defensively and `table`
    // narrows the union for callers.
    const change = {
      table,
      op: normalizedOp,
      record,
      oldRecord: env.old_record ?? null,
    } as RealtimeChange;

    try {
      this.handlers.onChange(change);
    } catch (err) {
      console.error("[realtime] onChange handler threw", err);
    }
  }

  // ---- reconnect / heartbeat plumbing ----

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    this.clearReconnectTimer();
    this.reconnectAttempts += 1;
    // Exponential backoff capped at 10s, with jitter to avoid thundering herd.
    const base = Math.min(10_000, 500 * 2 ** Math.min(this.reconnectAttempts, 5));
    const delay = base + Math.floor(Math.random() * 400);
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // If we go silent for too long the connection is probably half-open; force a
  // reconnect. Butterbase emits periodic heartbeats so 35s of silence is a red
  // flag.
  private armHeartbeatWatchdog(): void {
    this.clearHeartbeatWatchdog();
    this.heartbeatWatchdog = setTimeout(() => {
      console.warn("[realtime] heartbeat timeout — recycling socket");
      try {
        this.ws?.close();
      } catch {
        /* ignore */
      }
    }, 35_000);
  }

  private clearHeartbeatWatchdog(): void {
    if (this.heartbeatWatchdog) {
      clearTimeout(this.heartbeatWatchdog);
      this.heartbeatWatchdog = null;
    }
  }

  /** Tear down the socket and stop reconnecting. */
  close(): void {
    this.closedByUser = true;
    this.clearReconnectTimer();
    this.clearHeartbeatWatchdog();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }
}

/**
 * Convenience factory: spin up a connected client in one call. Returns the
 * client (call `.close()` to tear down). Typically used inside a React effect.
 */
export function connectRealtime(
  handlers: RealtimeHandlers,
  opts: RealtimeClientOptions = {},
): RealtimeClient {
  const client = new RealtimeClient(handlers, opts);
  client.connect();
  return client;
}
