"use client";

// DEAD DROP — pitch deck (/deck).
//
// A full-screen, keyboard-navigable presentation for the judges that explains
// how DEAD DROP works. Client component (keyboard nav + transitions). Pure
// presentation: no env, no server imports, no DB. Styled with Tailwind
// utilities + inline styles only; the look mirrors the mission-control
// dashboard (near-black, Geist Mono, DEAD/DROP wordmark, scope accents).
//
// Content lives in src/components/deck/slides.tsx; chrome lives here.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  COLOR,
  DeckBackground,
  Wordmark,
} from "@/components/deck/primitives";
import { SLIDES } from "@/components/deck/slides";

const COUNT = SLIDES.length;

export default function DeckPage() {
  const [index, setIndex] = useState(0);
  // Direction of the last move (1 forward / -1 back) → drives the slide-in.
  const [dir, setDir] = useState(1);
  // Bumped on every navigation so the active slide re-mounts and re-animates.
  const [animKey, setAnimKey] = useState(0);

  const clamp = useCallback((n: number) => Math.max(0, Math.min(COUNT - 1, n)), []);

  const go = useCallback(
    (next: number) => {
      setIndex((cur) => {
        const target = clamp(next);
        if (target !== cur) {
          setDir(target > cur ? 1 : -1);
          setAnimKey((k) => k + 1);
        }
        return target;
      });
    },
    [clamp],
  );

  const prev = useCallback(() => go(index - 1), [go, index]);
  const next = useCallback(() => go(index + 1), [go, index]);

  // ── Keyboard navigation ────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowRight":
        case " ":
        case "PageDown":
          e.preventDefault();
          next();
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          prev();
          break;
        case "Home":
          e.preventDefault();
          go(0);
          break;
        case "End":
          e.preventDefault();
          go(COUNT - 1);
          break;
        default:
          // number keys 1..9 jump to a slide
          if (/^[1-9]$/.test(e.key)) {
            e.preventDefault();
            go(Number(e.key) - 1);
          }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, go]);

  // ── Touch / swipe (phones, laptop trackpads, touch projectors) ─────────
  // Track both axes so a horizontal flick changes slides while a vertical
  // drag is left to scroll a tall slide's own content. A move only counts as
  // a slide change when it's clearly horizontal (|dx| dominates |dy|).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.changedTouches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touch.current === null) return;
    const t = e.changedTouches[0];
    const dx = (t?.clientX ?? touch.current.x) - touch.current.x;
    const dy = (t?.clientY ?? touch.current.y) - touch.current.y;
    // horizontal intent: travels far enough AND is more sideways than vertical
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      (dx < 0 ? next : prev)();
    }
    touch.current = null;
  };

  const accent = SLIDES[index]?.accent ?? COLOR.sky;
  const pct = COUNT > 1 ? (index / (COUNT - 1)) * 100 : 100;

  return (
    <main
      className="relative flex h-screen w-full flex-col overflow-hidden font-mono text-white"
      style={{ background: COLOR.bg }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <DeckBackground accent={accent} />

      {/* ── Top bar: wordmark · slide counter · progress ──────────────── */}
      <header className="relative z-10 flex items-center justify-between px-5 py-3 sm:px-7">
        <div className="flex items-baseline gap-3">
          <Wordmark className="text-sm tracking-[0.32em] sm:text-base" />
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.3em] text-white/30 sm:inline">
            pitch deck
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums text-white/45 sm:text-xs">
          <span style={{ color: accent }}>
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="text-white/25">/</span>
          <span>{String(COUNT).padStart(2, "0")}</span>
        </div>
      </header>

      {/* progress bar */}
      <div className="relative z-10 h-[2px] w-full bg-white/[0.06]">
        <div
          className="h-full"
          style={{
            width: `${pct}%`,
            background: accent,
            boxShadow: `0 0 10px ${accent}`,
            transition: "width 420ms cubic-bezier(0.22,1,0.36,1), background 420ms ease",
          }}
        />
      </div>

      {/* ── Slide stage ───────────────────────────────────────────────── */}
      {/* Scrolls vertically (tall slides on small screens scroll instead of
          clipping) and clips horizontally so a slide can never produce a
          page-level horizontal scrollbar. */}
      <section className="relative z-10 min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        <div
          key={animKey}
          className="deck-slide-in min-h-full"
          style={
            {
              // Entrance rises vertically (direction-aware). Vertical motion
              // never spills past the viewport width, so it stays overflow-safe
              // at any size — unlike a horizontal slide inside a clipped stage.
              ["--from-y" as string]: dir >= 0 ? "40px" : "-40px",
            } as React.CSSProperties
          }
        >
          {SLIDES[index]?.render()}
        </div>
      </section>

      {/* ── Dot-nav / section list ────────────────────────────────────── */}
      {/* Touch-friendly: each control reserves a ≥44px tap target (min-w/-h)
          while the visible dot stays small; the text labels only appear at lg
          so phones get clean, uncramped dots. */}
      <nav
        className="relative z-10 flex shrink-0 items-center justify-center gap-0.5 px-3 py-2 sm:gap-2 sm:py-3"
        aria-label="slides"
      >
        {SLIDES.map((s, i) => {
          const active = i === index;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => go(i)}
              title={`${i + 1}. ${s.label}`}
              aria-label={`Slide ${i + 1}: ${s.label}`}
              aria-current={active ? "true" : undefined}
              className="group flex min-h-11 min-w-9 flex-col items-center justify-center gap-1.5 px-1 sm:min-w-0 lg:min-h-0 lg:py-1"
            >
              <span
                className="block rounded-full transition-all duration-300"
                style={{
                  width: active ? 26 : 9,
                  height: 9,
                  background: active ? accent : "rgba(255,255,255,0.24)",
                  boxShadow: active ? `0 0 10px ${accent}` : "none",
                }}
              />
              <span
                className="hidden font-mono text-[9px] uppercase tracking-[0.18em] transition-colors lg:block"
                style={{ color: active ? accent : "rgba(255,255,255,0.28)" }}
              >
                {s.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* ── Prev / Next click targets (edges) ─────────────────────────── */}
      {/* Desktop affordance only — on touch these would overlap slide content
          and swallow edge taps, so swipe + the dot-nav drive mobile instead. */}
      <button
        type="button"
        onClick={prev}
        disabled={index === 0}
        aria-label="Previous slide"
        className="group absolute inset-y-0 left-0 z-20 hidden w-16 items-center justify-start pl-3 disabled:pointer-events-none disabled:opacity-0 md:flex lg:w-24"
      >
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full border text-lg opacity-40 transition-all group-hover:opacity-100"
          style={{ borderColor: `${accent}55`, background: "rgba(4,7,10,0.6)", color: accent }}
        >
          {"‹"}
        </span>
      </button>
      <button
        type="button"
        onClick={next}
        disabled={index === COUNT - 1}
        aria-label="Next slide"
        className="group absolute inset-y-0 right-0 z-20 hidden w-16 items-center justify-end pr-3 disabled:pointer-events-none disabled:opacity-0 md:flex lg:w-24"
      >
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full border text-lg opacity-40 transition-all group-hover:opacity-100"
          style={{ borderColor: `${accent}55`, background: "rgba(4,7,10,0.6)", color: accent }}
        >
          {"›"}
        </span>
      </button>

      {/* component-scoped animation (no globals.css edits) */}
      <style>{`
        @keyframes deckSlideIn {
          from { opacity: 0; transform: translateY(var(--from-y, 40px)); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .deck-slide-in {
          animation: deckSlideIn 480ms cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: opacity, transform;
        }
        @media (prefers-reduced-motion: reduce) {
          .deck-slide-in { animation: none; }
        }
      `}</style>
    </main>
  );
}
