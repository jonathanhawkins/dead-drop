"use client";

// One scoped column of streaming facts (world / player / handler-secret).
// Superseded facts are struck through and dimmed; freshly-arrived facts flash
// in. Reconciliation ops (supersede / reconcile / revise) get an accent rail so
// the audience can see a belief getting rewritten in real time.

import type { CSSProperties } from "react";
import type { FactOp, Scope } from "@/lib/types";
import type { DashboardFact } from "./useDashboardState";

export interface ScopeTheme {
  label: string;
  sub: string;
  accent: string; // primary hue for this column
  glow: string; // translucent accent for flashes/halos
  dim: string; // border/idle accent
}

export const SCOPE_THEMES: Record<Scope, ScopeTheme> = {
  world: {
    label: "WORLD",
    sub: "objective truth",
    accent: "#38bdf8", // sky
    glow: "rgba(56,189,248,0.18)",
    dim: "rgba(56,189,248,0.30)",
  },
  player: {
    label: "PLAYER",
    sub: "what the operative believes",
    accent: "#fbbf24", // amber
    glow: "rgba(251,191,36,0.18)",
    dim: "rgba(251,191,36,0.30)",
  },
  "handler-secret": {
    label: "HANDLER · SECRET",
    sub: "private intel — never corrects the player",
    accent: "#f43f5e", // rose
    glow: "rgba(244,63,94,0.18)",
    dim: "rgba(244,63,94,0.30)",
  },
};

const RECONCILE_OPS: FactOp[] = ["supersede", "reconcile", "revise"];

function opLabel(op: FactOp): string {
  switch (op) {
    case "assert":
      return "ASSERT";
    case "revise":
      return "REVISE";
    case "supersede":
      return "SUPERSEDE";
    case "reconcile":
      return "RECONCILE";
    default:
      return String(op).toUpperCase();
  }
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function FactCard({ fact, theme }: { fact: DashboardFact; theme: ScopeTheme }) {
  const isReconcile = RECONCILE_OPS.includes(fact.op);
  const struck = fact.superseded;

  const cardStyle: CSSProperties = {
    borderLeft: `3px solid ${isReconcile ? theme.accent : theme.dim}`,
    background: fact.fresh
      ? theme.glow
      : struck
        ? "rgba(255,255,255,0.015)"
        : "rgba(255,255,255,0.035)",
    boxShadow: fact.fresh ? `0 0 0 1px ${theme.dim}, 0 0 22px ${theme.glow}` : "none",
    transition: "background 700ms ease, box-shadow 700ms ease",
    opacity: struck ? 0.5 : 1,
  };

  return (
    <li
      className="rounded-md px-3 py-2"
      style={cardStyle}
      data-op={fact.op}
      data-superseded={struck ? "true" : "false"}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span
          className="text-[10px] font-bold tracking-[0.18em] uppercase"
          style={{ color: isReconcile ? theme.accent : "rgba(255,255,255,0.45)" }}
        >
          {opLabel(fact.op)}
          {isReconcile && struck === false ? " ▸" : ""}
        </span>
        <span className="text-[10px] tabular-nums text-white/30 font-mono">{timeOf(fact.createdAt)}</span>
      </div>

      <p
        className="text-[13px] leading-snug font-mono text-white/90"
        style={
          struck
            ? { textDecoration: "line-through", textDecorationColor: theme.accent, color: "rgba(255,255,255,0.55)" }
            : undefined
        }
      >
        {fact.content || <span className="text-white/30 italic">(no content)</span>}
      </p>

      {fact.note ? (
        <p className="mt-1 text-[11px] italic leading-snug" style={{ color: theme.accent }}>
          ↳ {fact.note}
        </p>
      ) : null}
    </li>
  );
}

export interface FactColumnProps {
  scope: Scope;
  facts: DashboardFact[];
}

export function FactColumn({ scope, facts }: FactColumnProps) {
  const theme = SCOPE_THEMES[scope];
  const liveCount = facts.filter((f) => !f.superseded).length;

  return (
    <section
      className="flex flex-col min-h-0 rounded-lg overflow-hidden"
      style={{
        background: "rgba(8,10,14,0.72)",
        border: `1px solid ${theme.dim}`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.03)`,
      }}
      aria-label={`${theme.label} facts`}
    >
      <header
        className="px-3 py-2 flex items-baseline justify-between"
        style={{ borderBottom: `1px solid ${theme.dim}`, background: theme.glow }}
      >
        <div>
          <h2 className="text-sm font-black tracking-[0.22em]" style={{ color: theme.accent }}>
            {theme.label}
          </h2>
          <p className="text-[10px] uppercase tracking-[0.14em] text-white/35">{theme.sub}</p>
        </div>
        <span
          className="text-[11px] font-mono tabular-nums px-2 py-0.5 rounded"
          style={{ color: theme.accent, border: `1px solid ${theme.dim}` }}
          title="live facts in scope"
        >
          {liveCount}
        </span>
      </header>

      <ul className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {facts.length === 0 ? (
          <li className="text-[12px] text-white/25 font-mono px-1 py-6 text-center">
            awaiting intel…
          </li>
        ) : (
          facts.map((f) => <FactCard key={f.logId} fact={f} theme={theme} />)
        )}
      </ul>
    </section>
  );
}
