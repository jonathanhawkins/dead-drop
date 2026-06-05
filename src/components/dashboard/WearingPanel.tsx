"use client";

// The field-actor panel. Once the operative answers "what are you wearing?" the
// answer lands in game_state.wearing and we blow it up HUGE so the real-world
// courier can read it across the room and walk up with the envelope. Until then
// it shows the current beat and a holding message.

import type { CSSProperties } from "react";
import type { Beat, GameState } from "@/lib/types";

const BEAT_LABEL: Record<Beat, string> = {
  intro: "INTRO · awaiting contact",
  cache_recovered: "CACHE RECOVERED",
  courier_lie: "COVER PLANTED",
  contradiction: "CONTRADICTION · belief reconciled",
  finale_identify: "IDENTIFY · ask what they're wearing",
  solve: "HANDOFF · courier moving in",
  signed_off: "SIGNED OFF",
};

// The actor should act when we're identifying or handing off.
const ACTION_BEATS: Beat[] = ["finale_identify", "solve"];

export interface WearingPanelProps {
  game: GameState | null;
}

export function WearingPanel({ game }: WearingPanelProps) {
  const wearing = game?.wearing?.trim() || "";
  const beat = game?.beat;
  const fragment = game?.digital_fragment?.trim() || "";
  const armed = beat ? ACTION_BEATS.includes(beat) : false;
  const live = wearing.length > 0;

  const accent = live ? "#34d399" : armed ? "#fbbf24" : "rgba(255,255,255,0.35)";
  const glow = live ? "rgba(52,211,153,0.16)" : armed ? "rgba(251,191,36,0.12)" : "transparent";

  const wrapStyle: CSSProperties = {
    background: "rgba(8,10,14,0.78)",
    border: `1px solid ${live ? "rgba(52,211,153,0.45)" : armed ? "rgba(251,191,36,0.4)" : "rgba(255,255,255,0.08)"}`,
    boxShadow: live ? `0 0 40px ${glow}, inset 0 0 60px ${glow}` : "none",
    transition: "box-shadow 600ms ease, border-color 600ms ease",
  };

  return (
    <section className="rounded-lg p-4 sm:p-6 flex flex-col" style={wrapStyle} aria-label="Field actor — operative identification">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[11px] sm:text-xs font-black tracking-[0.3em] uppercase" style={{ color: accent }}>
          ▣ Field Actor · Identify the Operative
        </h2>
        {beat ? (
          <span className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.16em] text-white/40">
            {BEAT_LABEL[beat]}
          </span>
        ) : null}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center py-4 min-h-[120px]">
        {live ? (
          <>
            <span className="text-[10px] sm:text-xs uppercase tracking-[0.4em] text-white/40 mb-2">
              They are wearing
            </span>
            <p
              className="font-black leading-[1.05] tracking-tight"
              style={{
                color: "#ecfdf5",
                fontSize: "clamp(2.2rem, 6vw, 5.5rem)",
                textShadow: "0 0 30px rgba(52,211,153,0.35)",
                wordBreak: "break-word",
              }}
            >
              {wearing.toUpperCase()}
            </p>
          </>
        ) : (
          <p
            className="font-bold uppercase tracking-[0.18em]"
            style={{ color: accent, fontSize: "clamp(1.1rem, 2.6vw, 1.9rem)" }}
          >
            {armed ? "Awaiting operative's description…" : "Standing by for identification"}
          </p>
        )}
      </div>

      {(fragment || game?.final_answer) && (
        <div className="mt-2 pt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 border-t border-white/10 text-center">
          {fragment ? (
            <span className="text-[11px] sm:text-xs font-mono text-white/55">
              fragment <strong className="text-emerald-300 tracking-wider">{fragment}</strong>
            </span>
          ) : null}
          <span className="text-[11px] sm:text-xs font-mono text-white/55">
            envelope half <strong className="text-amber-300 tracking-wider">SEVEN</strong>
          </span>
          {game?.final_answer ? (
            <span className="text-[11px] sm:text-xs font-mono text-white/55">
              passphrase <strong className="text-white tracking-wider">{game.final_answer}</strong>
            </span>
          ) : null}
        </div>
      )}
    </section>
  );
}
