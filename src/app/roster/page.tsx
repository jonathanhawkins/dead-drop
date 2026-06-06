"use client";

// DEAD DROP — AGENT ROSTER (operator view).
//
// "How many people connected and played?" One row per play-through (session),
// labeled by codename / iMessage name / masked phone, with a compact 7-step
// progress indicator (the mission beats), message + photo counts, and when they
// were last active. Click a row to open that operative's session in mission
// control (/dashboard?session=<id>).
//
// Client-only: it polls GET /api/roster every 5s (which holds the service key
// server-side). No secrets touch this bundle; phones default to masked last-4
// with an operator "reveal" toggle, and full phones are never logged.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Mirrors the BEAT_ORDER in @/lib/types — the seven mission beats, room-facing
// labels. We can't import the server route's types here (its module pulls in the
// server-only butterbase client), so the shape is declared locally and kept in
// step with /api/roster.
const BEAT_STEPS: { label: string }[] = [
  { label: "INTRO" },
  { label: "CACHE RECOVERED" },
  { label: "COVER PLANTED" },
  { label: "CONTRADICTION" },
  { label: "IDENTIFY" },
  { label: "HANDOFF" },
  { label: "SIGNED OFF" },
];
const BEAT_COUNT = BEAT_STEPS.length;

interface RosterEntry {
  sessionId: string;
  playerId: string;
  label: string;
  codename: string | null;
  handle: string | null;
  phoneFull: string | null;
  phoneMasked: string | null;
  beat: string | null;
  beatIndex: number;
  beatLabel: string;
  status: string;
  messageCount: number;
  photoCount: number;
  startedAt: string | null;
  lastActiveAt: string | null;
}

interface RosterTotals {
  players: number;
  sessions: number;
  active: number;
  completed: number;
}

interface RosterResponse {
  ok: boolean;
  totals: RosterTotals;
  entries: RosterEntry[];
}

const POLL_MS = 5000;

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" });
}

// Compact relative "last active" — reads at a glance on the operator wall.
function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 10) return "now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Status pill color: a completed mission reads emerald, an aborted one rose,
// anything live amber.
function statusTheme(status: string, completed: boolean): { color: string; bg: string; border: string } {
  if (completed) return { color: "#34d399", bg: "rgba(52,211,153,0.1)", border: "rgba(52,211,153,0.35)" };
  if (status === "aborted") return { color: "#fb7185", bg: "rgba(244,63,94,0.1)", border: "rgba(244,63,94,0.35)" };
  if (status === "active") return { color: "#fbbf24", bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.35)" };
  return { color: "rgba(255,255,255,0.55)", bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.2)" };
}

// The 7-step beat indicator. Filled (emerald) up to and including the current
// beat; the active step gets a halo; remaining steps are faint.
function BeatProgress({ beatIndex, beatLabel }: { beatIndex: number; beatLabel: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1" title={beatLabel} aria-label={`beat ${beatLabel}`}>
        {BEAT_STEPS.map((_, i) => {
          const done = beatIndex >= 0 && i <= beatIndex;
          const active = i === beatIndex;
          return (
            <span
              key={i}
              className="h-2 w-4 rounded-sm transition-colors"
              style={{
                background: done ? "#34d399" : "rgba(255,255,255,0.12)",
                boxShadow: active ? "0 0 8px rgba(52,211,153,0.8)" : "none",
                opacity: done ? (active ? 1 : 0.7) : 1,
              }}
            />
          );
        })}
      </div>
      <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-white/45 tabular-nums hidden xl:inline">
        {beatIndex >= 0 ? `${beatIndex + 1}/${BEAT_COUNT}` : "—"} · {beatLabel}
      </span>
    </div>
  );
}

export default function RosterPage() {
  const router = useRouter();
  const [data, setData] = useState<RosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reveal, setReveal] = useState(false);
  // Live "Xs ago" without refetching — a 1s tick re-renders the relative times.
  const [, setNow] = useState(0);

  // Avoid setting state after unmount when a slow fetch resolves late.
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/roster", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as RosterResponse;
      if (!mountedRef.current) return;
      setData(json);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      // Don't log — keep any phone data out of the console entirely.
      setError(err instanceof Error ? err.message : "failed to load roster");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // Poll every 5s; clear the interval on unmount (per spec).
  useEffect(() => {
    mountedRef.current = true;
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(id);
    };
  }, [load]);

  // 1s clock so relative "last active" stays fresh between polls.
  useEffect(() => {
    const id = window.setInterval(() => setNow((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Row click → open that play-through in mission control.
  const openSession = useCallback(
    (sessionId: string) => {
      router.push(`/dashboard?session=${encodeURIComponent(sessionId)}`);
    },
    [router],
  );

  const totals = data?.totals;
  const entries = data?.entries ?? [];
  const headcount = totals?.sessions ?? 0;

  return (
    <main
      className="flex min-h-screen w-full flex-col text-white"
      style={{
        background:
          "radial-gradient(1200px 600px at 50% -10%, rgba(56,189,248,0.07), transparent 60%), #05070a",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-3 shrink-0">
        <div className="flex items-baseline gap-4">
          <a href="/dashboard" className="text-xl font-black tracking-[0.34em] text-white sm:text-2xl">
            DEAD<span className="text-sky-400">DROP</span>
          </a>
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.3em] text-white/35 sm:inline">
            agent roster
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors"
            style={{
              color: reveal ? "#fbbf24" : "rgba(255,255,255,0.55)",
              borderColor: reveal ? "rgba(251,191,36,0.45)" : "rgba(255,255,255,0.18)",
              background: reveal ? "rgba(251,191,36,0.08)" : "transparent",
            }}
            title="operator tool — show full phone numbers"
          >
            {reveal ? "● phones revealed" : "○ reveal phones"}
          </button>
          <a
            href="/dashboard"
            className="rounded-md border border-white/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-white/60 transition-colors hover:border-sky-400/50 hover:text-sky-200"
          >
            mission control →
          </a>
        </div>
      </header>

      {/* ── Count banner ───────────────────────────────────────── */}
      <section className="flex flex-wrap items-end justify-between gap-4 px-6 pb-2 pt-6 shrink-0">
        <div className="flex items-baseline gap-4">
          <h1 className="text-5xl font-black tracking-tight tabular-nums text-white sm:text-6xl">
            {headcount}
          </h1>
          <div className="flex flex-col">
            <span className="text-2xl font-black tracking-[0.18em] text-white/90 sm:text-3xl">
              OPERATIVE{headcount === 1 ? "" : "S"}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
              {totals?.players ?? 0} connected · {totals?.sessions ?? 0} play-through
              {(totals?.sessions ?? 0) === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Stat label="active" value={totals?.active ?? 0} color="#fbbf24" />
          <Stat label="completed" value={totals?.completed ?? 0} color="#34d399" />
          <div className="flex items-center gap-1.5 pl-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background: error ? "#f43f5e" : "#34d399",
                boxShadow: `0 0 8px ${error ? "#f43f5e" : "#34d399"}`,
              }}
              aria-hidden
            />
            <span
              className="font-mono text-[10px] uppercase tracking-[0.16em]"
              style={{ color: error ? "#fb7185" : "rgba(255,255,255,0.4)" }}
            >
              {error ? "feed error" : "live · 5s"}
            </span>
          </div>
        </div>
      </section>

      {/* ── Table ──────────────────────────────────────────────── */}
      <section className="min-h-0 flex-1 px-4 pb-8 pt-3">
        <div
          className="overflow-hidden rounded-lg"
          style={{ background: "rgba(8,10,14,0.72)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-[0.16em] text-white/40">
                <Th>Codename / Name</Th>
                <Th>Phone</Th>
                <Th>Status</Th>
                <Th>Beat</Th>
                <Th className="text-right">Msgs</Th>
                <Th className="text-right">Photos</Th>
                <Th className="text-right">Started</Th>
                <Th className="text-right">Last active</Th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <p className="font-mono text-sm text-white/35">
                      {loading ? "Loading roster…" : "No operatives yet."}
                    </p>
                  </td>
                </tr>
              ) : (
                entries.map((e) => {
                  const completed = e.beat === "solve" || e.beat === "signed_off";
                  const st = statusTheme(e.status, completed);
                  return (
                    <tr
                      key={e.sessionId}
                      onClick={() => openSession(e.sessionId)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          openSession(e.sessionId);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      title="Open this session in mission control"
                      className="group cursor-pointer border-b border-white/[0.06] transition-colors hover:bg-sky-400/[0.06] focus:bg-sky-400/[0.08] focus:outline-none"
                    >
                      {/* Codename / Name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold tracking-wide text-white/90 group-hover:text-sky-200">
                            {e.label}
                          </span>
                          {e.codename && e.handle && e.codename !== e.handle ? (
                            <span className="font-mono text-[11px] text-white/35">({e.handle})</span>
                          ) : null}
                        </div>
                      </td>

                      {/* Phone (masked by default; reveal toggle) */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-[12px] tabular-nums text-white/55">
                          {reveal ? e.phoneFull ?? "—" : e.phoneMasked ?? "—"}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span
                          className="inline-block rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]"
                          style={{ color: st.color, background: st.bg, border: `1px solid ${st.border}` }}
                        >
                          {completed ? "completed" : e.status}
                        </span>
                      </td>

                      {/* Beat progress */}
                      <td className="px-4 py-3">
                        <BeatProgress beatIndex={e.beatIndex} beatLabel={e.beatLabel} />
                      </td>

                      {/* Msgs */}
                      <td className="px-4 py-3 text-right font-mono text-[12px] tabular-nums text-white/70">
                        {e.messageCount}
                      </td>

                      {/* Photos */}
                      <td className="px-4 py-3 text-right font-mono text-[12px] tabular-nums text-white/70">
                        {e.photoCount}
                      </td>

                      {/* Started */}
                      <td className="px-4 py-3 text-right font-mono text-[11px] tabular-nums text-white/45">
                        {fmtTime(e.startedAt)}
                      </td>

                      {/* Last active */}
                      <td className="px-4 py-3 text-right font-mono text-[11px] tabular-nums text-white/55">
                        {fmtAgo(e.lastActiveAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/25">
          click a row to open that operative&apos;s session in mission control
        </p>
      </section>
    </main>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="flex items-baseline gap-2 rounded-md px-3 py-1.5"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <span className="font-mono text-lg font-bold tabular-nums" style={{ color }}>
        {value}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">{label}</span>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-semibold ${className}`}>{children}</th>;
}
