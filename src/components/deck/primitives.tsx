"use client";

// DEAD DROP — deck presentational primitives.
//
// Small, dependency-free building blocks shared across the pitch slides:
// the wordmark, uppercase tracked labels/eyebrows, scope chips/columns that
// mirror the mission-control dashboard, the message→reply flow diagram, and a
// couple of layout helpers. Pure presentation — no state, no env, no server
// imports. Styled with Tailwind utilities + inline styles only.

import type { CSSProperties, ReactNode } from "react";

// ---------------------------------------------------------------------------
// Palette — mirrors src/components/dashboard/FactColumn.tsx so the deck reads
// like the same product. Scope accents: WORLD sky, PLAYER amber, HANDLER rose.
// ---------------------------------------------------------------------------
export const COLOR = {
  bg: "#04070a",
  bgPanel: "#0b1020",
  blue: "#3b82f6", // wordmark DROP + primary accent
  sky: "#38bdf8", // WORLD scope (matches dashboard)
  amber: "#fbbf24", // PLAYER scope
  rose: "#f43f5e", // HANDLER·SECRET scope
  green: "#34d399", // "live / verified" affordances (matches dashboard beat rail)
  ink: "rgba(255,255,255,0.92)",
  dim: "rgba(255,255,255,0.55)",
  faint: "rgba(255,255,255,0.32)",
} as const;

export type ScopeKey = "world" | "player" | "handler";

export const SCOPE: Record<
  ScopeKey,
  { label: string; sub: string; accent: string; glow: string; dim: string }
> = {
  world: {
    label: "WORLD",
    sub: "objective truth",
    accent: COLOR.sky,
    glow: "rgba(56,189,248,0.16)",
    dim: "rgba(56,189,248,0.34)",
  },
  player: {
    label: "PLAYER",
    sub: "what the operative believes",
    accent: COLOR.amber,
    glow: "rgba(251,191,36,0.16)",
    dim: "rgba(251,191,36,0.34)",
  },
  handler: {
    label: "HANDLER · SECRET",
    sub: "private intel — never corrects the player",
    accent: COLOR.rose,
    glow: "rgba(244,63,94,0.16)",
    dim: "rgba(244,63,94,0.34)",
  },
};

// ---------------------------------------------------------------------------
// Wordmark — DEAD (white) DROP (blue). Matches the dashboard header / landing.
// ---------------------------------------------------------------------------
export function Wordmark({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`font-black tracking-[0.3em] text-white ${className}`}
      style={style}
    >
      DEAD<span style={{ color: COLOR.blue }}>DROP</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Eyebrow — small uppercase tracked label above a heading.
// ---------------------------------------------------------------------------
export function Eyebrow({
  children,
  color = COLOR.faint,
  dot,
  className = "",
}: {
  children: ReactNode;
  color?: string;
  dot?: string; // if set, render a glowing status dot before the text
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 font-mono text-[11px] uppercase sm:text-[13px] ${className}`}
      style={{ color, letterSpacing: "0.34em" }}
    >
      {dot ? (
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: dot, boxShadow: `0 0 10px 2px ${dot}` }}
        />
      ) : null}
      {children}
    </div>
  );
}

// A small uppercase tracked tag/chip.
export function Tag({
  children,
  accent = COLOR.faint,
  filled = false,
  className = "",
}: {
  children: ReactNode;
  accent?: string;
  filled?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] sm:text-[11px] ${className}`}
      style={{
        color: accent,
        border: `1px solid ${accent}`,
        background: filled ? `${accent}1f` : "transparent",
      }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Panel — the recurring dark card used on most slides.
// ---------------------------------------------------------------------------
export function Panel({
  children,
  accent,
  className = "",
  style,
}: {
  children: ReactNode;
  accent?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`rounded-xl p-5 sm:p-6 ${className}`}
      style={{
        background: "rgba(8,12,22,0.72)",
        border: `1px solid ${accent ? accent : "rgba(255,255,255,0.10)"}`,
        boxShadow: accent
          ? `inset 0 1px 0 rgba(255,255,255,0.04), 0 0 32px ${accent}14`
          : "inset 0 1px 0 rgba(255,255,255,0.04)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScopeColumn — one of the three memory columns, mirroring the dashboard. Each
// fact can be "struck" (superseded), "fresh" (highlighted/new), or a planted
// lie (kept lit on purpose). `note` renders an accent annotation under a fact.
// ---------------------------------------------------------------------------
export interface ScopeFact {
  text: string;
  struck?: boolean;
  fresh?: boolean;
  note?: string;
  op?: string; // ASSERT / SUPERSEDE / RECONCILE label
}

export function ScopeColumn({
  scope,
  facts,
  className = "",
}: {
  scope: ScopeKey;
  facts: ScopeFact[];
  className?: string;
}) {
  const s = SCOPE[scope];
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-lg ${className}`}
      style={{
        background: "rgba(8,10,14,0.72)",
        border: `1px solid ${s.dim}`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
      }}
      aria-label={`${s.label} facts`}
    >
      <header
        className="flex items-baseline justify-between px-3 py-2"
        style={{ borderBottom: `1px solid ${s.dim}`, background: s.glow }}
      >
        <div>
          <h3
            className="text-[13px] font-black tracking-[0.22em] sm:text-sm"
            style={{ color: s.accent }}
          >
            {s.label}
          </h3>
          <p className="text-[9px] uppercase tracking-[0.14em] text-white/35 sm:text-[10px]">
            {s.sub}
          </p>
        </div>
        <span
          className="rounded px-2 py-0.5 font-mono text-[11px] tabular-nums"
          style={{ color: s.accent, border: `1px solid ${s.dim}` }}
        >
          {facts.filter((f) => !f.struck).length}
        </span>
      </header>

      <ul className="flex-1 space-y-2 overflow-y-auto p-2">
        {facts.map((f, i) => (
          <FactCard key={i} fact={f} accent={s.accent} dim={s.dim} glow={s.glow} />
        ))}
      </ul>
    </section>
  );
}

function FactCard({
  fact,
  accent,
  dim,
  glow,
}: {
  fact: ScopeFact;
  accent: string;
  dim: string;
  glow: string;
}) {
  const cardStyle: CSSProperties = {
    borderLeft: `3px solid ${fact.fresh ? accent : dim}`,
    background: fact.fresh
      ? glow
      : fact.struck
        ? "rgba(255,255,255,0.015)"
        : "rgba(255,255,255,0.035)",
    boxShadow: fact.fresh ? `0 0 0 1px ${dim}, 0 0 22px ${glow}` : "none",
    opacity: fact.struck ? 0.5 : 1,
  };
  return (
    <li className="rounded-md px-3 py-2" style={cardStyle}>
      {fact.op ? (
        <div
          className="mb-1 text-[9px] font-bold uppercase tracking-[0.18em] sm:text-[10px]"
          style={{ color: fact.fresh || fact.struck ? accent : "rgba(255,255,255,0.45)" }}
        >
          {fact.op}
          {fact.fresh ? " ▸" : ""}
        </div>
      ) : null}
      <p
        className="font-mono text-[12px] leading-snug text-white/90 sm:text-[13px]"
        style={
          fact.struck
            ? {
                textDecoration: "line-through",
                textDecorationColor: accent,
                color: "rgba(255,255,255,0.55)",
              }
            : undefined
        }
      >
        {fact.text}
      </p>
      {fact.note ? (
        <p
          className="mt-1 text-[10px] italic leading-snug sm:text-[11px]"
          style={{ color: accent }}
        >
          {"↳ "}
          {fact.note}
        </p>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// FlowDiagram — the message→reply spine as a horizontal chain of nodes, each
// tagged with the tool that does the work (color-coded). Wraps on small widths.
// ---------------------------------------------------------------------------
export interface FlowNode {
  label: string;
  tool: string; // PHOTON / AI / XTRACE / GAME / BUTTERBASE …
  accent: string;
}

export function FlowDiagram({ nodes }: { nodes: FlowNode[] }) {
  return (
    <div className="flex flex-wrap items-stretch justify-center gap-x-2 gap-y-3">
      {nodes.map((n, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className="flex h-full min-w-[7.5rem] flex-col justify-between rounded-lg px-3 py-2.5"
            style={{
              background: `${n.accent}10`,
              border: `1px solid ${n.accent}55`,
              boxShadow: `0 0 22px ${n.accent}10`,
            }}
          >
            <div
              className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] sm:text-[10px]"
              style={{ color: n.accent }}
            >
              {n.tool}
            </div>
            <div className="text-[12px] font-semibold leading-tight text-white/90 sm:text-[13px]">
              {n.label}
            </div>
          </div>
          {i < nodes.length - 1 ? (
            <span
              aria-hidden
              className="text-base"
              style={{ color: "rgba(255,255,255,0.28)" }}
            >
              {"→"}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Background — near-black bg with a tasteful grid + scanline texture + a soft
// top glow. Pure CSS, GPU-cheap (static gradients), no animation cost.
// ---------------------------------------------------------------------------
export function DeckBackground({ accent = COLOR.sky }: { accent?: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* top glow tinted to the active section's accent */}
      <div
        className="absolute inset-x-0 top-0 h-1/2"
        style={{
          background: `radial-gradient(1200px 520px at 50% -12%, ${accent}1c, transparent 62%)`,
          transition: "background 600ms ease",
        }}
      />
      {/* fine grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse 100% 80% at 50% 40%, black 55%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 100% 80% at 50% 40%, black 55%, transparent 100%)",
        }}
      />
      {/* scanlines */}
      <div
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 3px)",
        }}
      />
    </div>
  );
}
