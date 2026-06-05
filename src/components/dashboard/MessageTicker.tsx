"use client";

// The live wire. Streams every inbound (operative) and outbound (Handler)
// message as it hits the `messages` table. Inbound is the operative speaking;
// outbound is the Handler. Newest at the top, capped by the state hook.

import type { CSSProperties } from "react";
import type { TickerMessage } from "./useDashboardState";

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

interface Line {
  who: string;
  accent: string;
  align: "left" | "right";
  bg: string;
  border: string;
}

function lineFor(direction: TickerMessage["direction"]): Line {
  if (direction === "inbound") {
    return {
      who: "OPERATIVE",
      accent: "#fbbf24",
      align: "right",
      bg: "rgba(251,191,36,0.08)",
      border: "rgba(251,191,36,0.28)",
    };
  }
  if (direction === "outbound") {
    return {
      who: "HANDLER",
      accent: "#38bdf8",
      align: "left",
      bg: "rgba(56,189,248,0.08)",
      border: "rgba(56,189,248,0.28)",
    };
  }
  return {
    who: "SYSTEM",
    accent: "rgba(255,255,255,0.5)",
    align: "left",
    bg: "rgba(255,255,255,0.04)",
    border: "rgba(255,255,255,0.14)",
  };
}

function Bubble({ msg }: { msg: TickerMessage }) {
  const line = lineFor(msg.direction);
  const isImage = msg.contentType === "image";
  const style: CSSProperties = {
    background: line.bg,
    border: `1px solid ${line.border}`,
    alignSelf: line.align === "right" ? "flex-end" : "flex-start",
    maxWidth: "82%",
  };
  return (
    <li className="flex flex-col" style={{ alignItems: line.align === "right" ? "flex-end" : "flex-start" }}>
      <div className="flex items-center gap-2 mb-0.5 px-1">
        <span className="text-[9px] font-bold tracking-[0.2em] uppercase" style={{ color: line.accent }}>
          {line.who}
        </span>
        <span className="text-[9px] font-mono tabular-nums text-white/25">{timeOf(msg.createdAt)}</span>
      </div>
      <div className="rounded-lg px-3 py-1.5" style={style}>
        <p className="text-[13px] leading-snug text-white/90 font-mono">
          {isImage ? <span style={{ color: line.accent }}>◳ {msg.body}</span> : msg.body}
        </p>
      </div>
    </li>
  );
}

export interface MessageTickerProps {
  messages: TickerMessage[];
}

export function MessageTicker({ messages }: MessageTickerProps) {
  return (
    <section
      className="flex flex-col min-h-0 rounded-lg overflow-hidden"
      style={{ background: "rgba(8,10,14,0.72)", border: "1px solid rgba(255,255,255,0.08)" }}
      aria-label="Live message wire"
    >
      <header className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <h2 className="text-sm font-black tracking-[0.22em] text-white/80">◉ LIVE WIRE</h2>
        <span className="text-[10px] uppercase tracking-[0.14em] text-white/35 font-mono">{messages.length} msgs</span>
      </header>
      <ul className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2.5">
        {messages.length === 0 ? (
          <li className="text-[12px] text-white/25 font-mono px-1 py-6 text-center">no traffic yet…</li>
        ) : (
          messages.map((m) => <Bubble key={m.id} msg={m} />)
        )}
      </ul>
    </section>
  );
}
