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

  // ── Touch / swipe (laptop trackpads + touch projectors) ────────────────
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.changedTouches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
    if (Math.abs(dx) > 48) (dx < 0 ? next : prev)();
    touchX.current = null;
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
      <section className="relative z-10 min-h-0 flex-1">
        <div
          key={animKey}
          className="absolute inset-0 deck-slide-in"
          style={
            {
              // start offset depends on direction; CSS animation slides to 0
              ["--from" as string]: dir >= 0 ? "44px" : "-44px",
            } as React.CSSProperties
          }
        >
          {SLIDES[index]?.render()}
        </div>
      </section>

      {/* ── Dot-nav / section list ────────────────────────────────────── */}
      <nav
        className="relative z-10 flex items-center justify-center gap-2 px-4 py-3"
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
              className="group flex flex-col items-center gap-1.5 px-1 py-1"
            >
              <span
                className="block rounded-full transition-all duration-300"
                style={{
                  width: active ? 26 : 8,
                  height: 8,
                  background: active ? accent : "rgba(255,255,255,0.22)",
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
      <button
        type="button"
        onClick={prev}
        disabled={index === 0}
        aria-label="Previous slide"
        className="group absolute inset-y-0 left-0 z-20 flex w-16 items-center justify-start pl-3 disabled:pointer-events-none disabled:opacity-0 sm:w-24"
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
        className="group absolute inset-y-0 right-0 z-20 flex w-16 items-center justify-end pr-3 disabled:pointer-events-none disabled:opacity-0 sm:w-24"
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
          from { opacity: 0; transform: translateX(var(--from, 44px)); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .deck-slide-in {
          animation: deckSlideIn 480ms cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: opacity, transform;
        }
        @media (prefers-reduced-motion: reduce) {
          .deck-slide-in { animation-duration: 1ms; }
        }
      `}</style>
    </main>
  );
}
