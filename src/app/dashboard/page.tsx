"use client";

// DEAD DROP — MISSION CONTROL (projector view).
//
// A single live screen for the room: three scoped columns of streaming facts
// (world / player / handler-secret) with reconciliations highlighted, the
// active operative's WEARING blown up for the field actor, a live message wire,
// and an operator control bar (start session + manual beat overrides).
//
// Everything is driven by the Butterbase realtime feed via useDashboardState.
// Client-only; reads NEXT_PUBLIC_* env exclusively. No server imports.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Beat } from "@/lib/types";
import { BEAT_ORDER } from "@/lib/types";
import {
  ControlBar,
  FactColumn,
  MessageTicker,
  ReconcileBanner,
  WearingPanel,
  useDashboardState,
} from "@/components/dashboard";

const BEAT_DISPLAY: Record<Beat, string> = {
  intro: "INTRO",
  cache_recovered: "CACHE RECOVERED",
  courier_lie: "COVER PLANTED",
  contradiction: "CONTRADICTION",
  finale_identify: "IDENTIFY",
  solve: "HANDOFF",
  signed_off: "SIGNED OFF",
};

function BeatRail({ beat }: { beat: Beat | null }) {
  const activeIdx = beat ? BEAT_ORDER.indexOf(beat) : -1;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {BEAT_ORDER.map((b, i) => {
        const done = activeIdx >= 0 && i < activeIdx;
        const active = i === activeIdx;
        const color = active ? "#34d399" : done ? "rgba(52,211,153,0.5)" : "rgba(255,255,255,0.25)";
        return (
          <div key={b} className="flex items-center gap-1.5">
            <span
              className="text-[10px] font-mono uppercase tracking-[0.12em] px-2 py-0.5 rounded"
              style={{
                color,
                border: `1px solid ${active ? "rgba(52,211,153,0.5)" : "transparent"}`,
                background: active ? "rgba(52,211,153,0.1)" : "transparent",
                fontWeight: active ? 800 : 500,
              }}
            >
              {BEAT_DISPLAY[b]}
            </span>
            {i < BEAT_ORDER.length - 1 ? (
              <span className="text-white/15 text-[10px]">→</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  const state = useDashboardState();
  const { factsByScope, messages, reconciliations, game, status } = state;
  const [pinnedSession, setPinnedSession] = useState<string>("");
  const sessionId = pinnedSession || game?.session_id || "";

  // Live clock for the cinematic header (mounts client-side; avoids hydration drift).
  const [clock, setClock] = useState<string>("");
  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Best-effort: when we learn a sessionId, hydrate from /api/status so the
  // columns aren't empty if the operator opens the dashboard mid-mission.
  // Realtime then keeps it live. Failures are silent (realtime still works).
  const hydratedFor = useRef<string>("");
  const seedFromStatus = useCallback(async (sid: string) => {
    if (!sid || hydratedFor.current === sid) return;
    hydratedFor.current = sid;
    try {
      const res = await fetch(`/api/status?sessionId=${encodeURIComponent(sid)}`, { cache: "no-store" });
      if (!res.ok) return;
      // We intentionally don't merge historical facts into the realtime reducer
      // here (it keys off fact_log ids we don't have from /status); this call
      // simply confirms the session is reachable. Realtime carries the show.
      await res.json().catch(() => null);
    } catch {
      /* offline / route not up yet — realtime still drives the view */
    }
  }, []);

  useEffect(() => {
    if (sessionId) void seedFromStatus(sessionId);
  }, [sessionId, seedFromStatus]);

  const beat = game?.beat ?? null;

  return (
    <main
      className="flex flex-col h-screen w-full overflow-hidden text-white"
      style={{
        background:
          "radial-gradient(1200px 600px at 50% -10%, rgba(56,189,248,0.07), transparent 60%), #05070a",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
        <div className="flex items-baseline gap-4">
          <h1 className="text-xl sm:text-2xl font-black tracking-[0.34em] text-white">
            DEAD<span className="text-sky-400">DROP</span>
          </h1>
          <span className="text-[11px] uppercase tracking-[0.3em] text-white/35 font-mono hidden sm:inline">
            mission control
          </span>
        </div>

        <div className="flex-1 px-6 hidden md:flex justify-center">
          <BeatRail beat={beat} />
        </div>

        <div className="flex items-center gap-4">
          {sessionId ? (
            <span className="text-[10px] font-mono text-white/35 hidden lg:inline" title="active session">
              SES {sessionId.slice(0, 8)}
            </span>
          ) : null}
          <span className="text-[13px] font-mono tabular-nums text-sky-300/80 tracking-widest">{clock}</span>
        </div>
      </header>

      {/* mobile beat rail */}
      <div className="md:hidden px-4 py-2 border-b border-white/10 overflow-x-auto shrink-0">
        <BeatRail beat={beat} />
      </div>

      {/* ── Reconcile banner ───────────────────────────────────── */}
      {reconciliations.length > 0 ? (
        <div className="px-4 pt-3 shrink-0">
          <ReconcileBanner reconciliations={reconciliations} />
        </div>
      ) : null}

      {/* ── Main grid ──────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 grid gap-3 p-4 grid-cols-1 lg:grid-cols-[1.05fr_1.05fr_1.05fr_0.95fr]">
        <FactColumn scope="world" facts={factsByScope.world} />
        <FactColumn scope="player" facts={factsByScope.player} />
        <FactColumn scope="handler-secret" facts={factsByScope["handler-secret"]} />

        {/* Right rail: WEARING (huge) over the live wire. */}
        <div className="flex flex-col gap-3 min-h-0">
          <WearingPanel game={game} />
          <div className="flex-1 min-h-0">
            <MessageTicker messages={messages} />
          </div>
        </div>
      </div>

      {/* ── Control bar ────────────────────────────────────────── */}
      <div className="px-4 pb-4 shrink-0">
        <ControlBar game={game} status={status} onSession={setPinnedSession} />
      </div>
    </main>
  );
}
