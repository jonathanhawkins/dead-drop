"use client";

// Mission-control operator panel. Three actions, all fired from the projector
// laptop, all degrading gracefully:
//   • START SESSION  → prompt for a phone, POST /api/session/start {phone, handle?}
//   • ADVANCE BEAT   → POST /api/override {sessionId, action:"advance", token}
//   • MARK VERIFIED  → POST /api/override {sessionId, action:"mark_verified", token}
//
// The override token defaults to NEXT_PUBLIC_OVERRIDE_TOKEN but stays editable in
// a text input so the operator can paste the real one at the venue. The active
// sessionId comes from realtime (game_state) but can also be set by Start.

import { useEffect, useState } from "react";
import type { GameState } from "@/lib/types";
import type { ConnectionStatus } from "@/lib/realtime-client";

type Flash = { kind: "ok" | "err"; text: string } | null;

const DEFAULT_TOKEN = process.env.NEXT_PUBLIC_OVERRIDE_TOKEN ?? "";

async function postJSON(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON body — leave null */
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error("[control] request failed", url, err);
    return { ok: false, status: 0, data: { error: String(err) } };
  }
}

export interface ControlBarProps {
  game: GameState | null;
  status: ConnectionStatus;
  /** Called when Start returns a sessionId, so the page can pin it. */
  onSession?: (sessionId: string) => void;
}

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  open: "#34d399",
  connecting: "#fbbf24",
  closed: "#9ca3af",
  error: "#f43f5e",
};

export function ControlBar({ game, status, onSession }: ControlBarProps) {
  const [token, setToken] = useState<string>(DEFAULT_TOKEN);
  const [sessionId, setSessionId] = useState<string>("");
  const [busy, setBusy] = useState<null | "start" | "advance" | "verify">(null);
  const [flash, setFlash] = useState<Flash>(null);

  // Keep the override target synced to whatever session realtime is showing,
  // unless the operator has typed their own id.
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!pinned && game?.session_id && game.session_id !== sessionId) {
      setSessionId(game.session_id);
    }
  }, [game?.session_id, pinned, sessionId]);

  function note(kind: "ok" | "err", text: string) {
    setFlash({ kind, text });
    window.setTimeout(() => setFlash(null), 4000);
  }

  async function startSession() {
    const phone = window.prompt("Operative phone number (E.164, e.g. +14155551234):", "+1");
    if (!phone || phone.trim().length < 4) return;
    const handle = window.prompt("Optional codename / handle (blank for none):", "") ?? "";
    setBusy("start");
    const body: { phone: string; handle?: string } = { phone: phone.trim() };
    if (handle.trim()) body.handle = handle.trim();
    const r = await postJSON("/api/session/start", body);
    setBusy(null);

    const data = (r.data ?? {}) as Record<string, unknown>;
    const sid =
      (data.sessionId as string) ||
      ((data.session as Record<string, unknown> | undefined)?.id as string) ||
      ((data.state as Record<string, unknown> | undefined)?.session_id as string) ||
      "";
    if (r.ok && sid) {
      setSessionId(sid);
      setPinned(true);
      onSession?.(sid);
      note("ok", `Session started · ${phone.trim()}`);
    } else if (r.ok) {
      note("ok", `Session started · ${phone.trim()} (id pending)`);
    } else {
      note("err", `Start failed (${r.status || "no response"})`);
    }
  }

  async function override(action: "advance" | "mark_verified") {
    if (!sessionId.trim()) {
      note("err", "No sessionId — start a session first or paste one.");
      return;
    }
    if (!token.trim()) {
      note("err", "Override token is empty.");
      return;
    }
    setBusy(action === "advance" ? "advance" : "verify");
    const r = await postJSON("/api/override", {
      sessionId: sessionId.trim(),
      action,
      token: token.trim(),
    });
    setBusy(null);
    if (r.ok) {
      const data = (r.data ?? {}) as Record<string, unknown>;
      const st = (data.state ?? data) as Record<string, unknown> | undefined;
      const beat = (st?.beat as string) ?? "";
      note("ok", action === "advance" ? `Advanced${beat ? ` → ${beat}` : ""}` : "Marked verified");
    } else if (r.status === 401 || r.status === 403) {
      note("err", "Override rejected — bad token.");
    } else {
      note("err", `Override failed (${r.status || "no response"})`);
    }
  }

  const btnBase =
    "px-4 py-2 rounded-md text-sm font-bold tracking-wide uppercase transition disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-3"
      style={{ background: "rgba(8,10,14,0.85)", border: "1px solid rgba(255,255,255,0.1)" }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={startSession}
          disabled={busy === "start"}
          className={btnBase}
          style={{ background: "#22c55e", color: "#04140a" }}
        >
          {busy === "start" ? "Starting…" : "▶ Start Session"}
        </button>

        <button
          type="button"
          onClick={() => override("advance")}
          disabled={busy === "advance"}
          className={btnBase}
          style={{ background: "#f59e0b", color: "#1a1102" }}
        >
          {busy === "advance" ? "Advancing…" : "⏭ Advance Beat"}
        </button>

        <button
          type="button"
          onClick={() => override("mark_verified")}
          disabled={busy === "verify"}
          className={btnBase}
          style={{ background: "#38bdf8", color: "#03141c" }}
        >
          {busy === "verify" ? "Marking…" : "✔ Mark Verified"}
        </button>

        <div className="ml-auto flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: STATUS_COLOR[status], boxShadow: `0 0 8px ${STATUS_COLOR[status]}` }}
            aria-hidden
          />
          <span className="text-[11px] uppercase tracking-[0.16em] font-mono" style={{ color: STATUS_COLOR[status] }}>
            realtime {status}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-white/45 font-mono">
          session
          <input
            value={sessionId}
            onChange={(e) => {
              setSessionId(e.target.value);
              setPinned(true);
            }}
            placeholder="auto from realtime…"
            spellCheck={false}
            className="bg-black/50 border border-white/15 rounded px-2 py-1 text-[12px] text-white/90 font-mono w-[260px] focus:outline-none focus:border-sky-400/60"
          />
        </label>

        <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-white/45 font-mono">
          token
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="override token"
            spellCheck={false}
            type="password"
            className="bg-black/50 border border-white/15 rounded px-2 py-1 text-[12px] text-white/90 font-mono w-[220px] focus:outline-none focus:border-amber-400/60"
          />
        </label>

        {flash ? (
          <span
            className="ml-auto text-[12px] font-mono px-3 py-1 rounded"
            style={{
              color: flash.kind === "ok" ? "#34d399" : "#fb7185",
              background: flash.kind === "ok" ? "rgba(52,211,153,0.1)" : "rgba(244,63,94,0.1)",
              border: `1px solid ${flash.kind === "ok" ? "rgba(52,211,153,0.3)" : "rgba(244,63,94,0.3)"}`,
            }}
          >
            {flash.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
