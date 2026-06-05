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

import { useCallback, useEffect, useState } from "react";
import type { Beat } from "@/lib/types";
import { BEAT_ORDER } from "@/lib/types";
import {
  ControlBar,
  CourierPanel,
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

type PanelKey = "actor" | "courier" | "wire";

export default function DashboardPage() {
  const state = useDashboardState();
  const { factsByScope, scopedMessages, reconciliations, game, status } = state;
  const [pinnedSession, setPinnedSession] = useState<string>("");
  const sessionId = pinnedSession || game?.session_id || "";

  // Collapse state for the right-rail panels so the operator can fit everything
  // on the projector. Persisted to localStorage; loaded after mount to avoid
  // hydration drift on the static prerender.
  const [collapsed, setCollapsed] = useState<Record<PanelKey, boolean>>({
    actor: false,
    courier: false,
    wire: false,
  });
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("dd:panels");
      if (raw) setCollapsed((c) => ({ ...c, ...JSON.parse(raw) }));
    } catch {
      /* no-op */
    }
  }, []);
  const togglePanel = useCallback((key: PanelKey) => {
    setCollapsed((c) => {
      const next = { ...c, [key]: !c[key] };
      try {
        window.localStorage.setItem("dd:panels", JSON.stringify(next));
      } catch {
        /* no-op */
      }
      return next;
    });
  }, []);

  // Live clock for the cinematic header (mounts client-side; avoids hydration drift).
  const [clock, setClock] = useState<string>("");
  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Cold-start hydration is handled inside useDashboardState: it fetches
  // /api/dashboard/snapshot on mount and folds the existing world / handler-secret
  // / player facts, recent messages, and game_state in UNDER the realtime stream
  // (deduped by id), so the columns render immediately instead of waiting for the
  // next live event. Realtime then keeps everything updating in place.

  const beat = game?.beat ?? null;

  // Pure client-side inference of the ~10s reply gap: if the most-recent wire
  // message (ignoring system lines) is inbound, the operative just spoke and the
  // Handler is composing a reply. scopedMessages is newest-first and already
  // scoped to the active session, so the first non-system entry is the latest.
  const lastWire = scopedMessages.find((m) => m.direction !== "system");
  const handlerComposing = lastWire?.direction === "inbound";

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

        {/* Right rail: WEARING (huge) over the FIELD COURIER card and the live wire.
            Each panel collapses so the operator can fit everything; the LIVE WIRE
            grows to fill whatever space the others give up. */}
        <div className="flex flex-col gap-3 min-h-0">
          <div className="shrink-0">
            <WearingPanel
              game={game}
              collapsed={collapsed.actor}
              onToggleCollapse={() => togglePanel("actor")}
            />
          </div>
          {/* "How it scales": the real-human courier bounty + live applicants. */}
          <div className="shrink-0">
            <CourierPanel
              collapsed={collapsed.courier}
              onToggleCollapse={() => togglePanel("courier")}
            />
          </div>
          <div className={collapsed.wire ? "shrink-0" : "flex-1 min-h-0"}>
            <MessageTicker
              messages={scopedMessages}
              composing={handlerComposing}
              collapsed={collapsed.wire}
              onToggleCollapse={() => togglePanel("wire")}
            />
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
