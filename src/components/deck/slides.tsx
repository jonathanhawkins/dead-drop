"use client";

// DEAD DROP — pitch deck slides.
//
// Each slide is a self-contained presentational component. The deck shell
// (src/app/deck/page.tsx) owns navigation/chrome; this file owns content. Every
// claim here is verified against the real implementation (src/lib/{loop,game,
// content,memory,photon,ai}.ts and the docs) — keep it true.

import type { ReactNode } from "react";
import {
  COLOR,
  Eyebrow,
  FlowDiagram,
  Panel,
  ScopeColumn,
  Tag,
  Wordmark,
  type FlowNode,
  type ScopeFact,
} from "./primitives";

// ---------------------------------------------------------------------------
// Shared slide frame: centers content, caps width, consistent vertical rhythm.
// ---------------------------------------------------------------------------
function Slide({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  // min-h-full (not h-full): the slide fills the stage when content is short
  // (so justify-center keeps it vertically centered) but is allowed to grow
  // taller than the viewport on small screens — the stage then scrolls it
  // rather than clipping. Padding tightens on phones to buy vertical room.
  return (
    <div
      className={`mx-auto flex min-h-full w-full max-w-6xl flex-col justify-center px-5 py-8 sm:px-10 sm:py-14 ${className}`}
    >
      {children}
    </div>
  );
}

function SlideHeading({
  eyebrow,
  eyebrowColor,
  title,
  accent = COLOR.sky,
}: {
  eyebrow: string;
  eyebrowColor?: string;
  title: ReactNode;
  accent?: string;
}) {
  return (
    <div className="mb-6 sm:mb-8">
      <Eyebrow color={eyebrowColor ?? accent}>{eyebrow}</Eyebrow>
      <h2 className="mt-3 text-2xl font-black leading-[1.05] tracking-tight text-white sm:text-4xl lg:text-5xl">
        {title}
      </h2>
    </div>
  );
}

// ===========================================================================
// 1 — TITLE
// ===========================================================================
function TitleSlide() {
  return (
    <Slide className="items-center text-center">
      <Eyebrow color={COLOR.green} dot={COLOR.green} className="justify-center">
        channel open · agentic ai sf
      </Eyebrow>

      <h1
        className="mt-8 text-[clamp(3rem,12vw,9rem)] font-black leading-none"
        style={{ letterSpacing: "0.04em" }}
      >
        <Wordmark
          className="tracking-[0.06em]"
          style={{ textShadow: "0 0 44px rgba(59,130,246,0.35)" }}
        />
      </h1>

      <p className="mx-auto mt-8 max-w-3xl text-base leading-relaxed text-white/75 sm:text-xl lg:text-2xl">
        A real-world ARG that infiltrates your phone, remembers everything you
        do, and ends with a stranger handing you an envelope.
      </p>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-2.5">
        <Tag accent={COLOR.sky}>iMessage-native</Tag>
        <Tag accent={COLOR.amber}>LLM Handler</Tag>
        <Tag accent={COLOR.rose}>self-revising memory</Tag>
        <Tag accent={COLOR.green}>steps out of the phone</Tag>
      </div>

      <p className="mt-12 font-mono text-[11px] uppercase tracking-[0.34em] text-white/35 sm:text-xs">
        ← / → / space to navigate
      </p>
    </Slide>
  );
}

// ===========================================================================
// 2 — THE HOOK (Majestic 2001 vs now)
// ===========================================================================
function HookSlide() {
  const rows: { axis: string; then: string; now: string; accent: string }[] = [
    {
      axis: "The character",
      then: "Canned recordings. No memory, no improvisation.",
      now: "A live LLM Handler that reacts to what you actually did.",
      accent: COLOR.amber,
    },
    {
      axis: "Phone delivery",
      then: "Calls + texts that reportedly cost EA ~$20M to wire up.",
      now: "Photon — iMessage in & out behind a single API.",
      accent: COLOR.sky,
    },
    {
      axis: "The story",
      then: "A fixed script. It couldn't remember what you uncovered.",
      now: "Scoped memory that rewrites itself — and keeps the lie you were told.",
      accent: COLOR.rose,
    },
  ];
  return (
    <Slide>
      <SlideHeading
        eyebrow="the hook"
        accent={COLOR.amber}
        title={
          <>
            The game EA tried to build in 2001 —{" "}
            <span style={{ color: COLOR.amber }}>now it actually works.</span>
          </>
        }
      />
      <p className="mb-6 max-w-3xl text-sm leading-relaxed text-white/70 sm:text-lg">
        In 2001, EA shipped <span className="text-white">Majestic</span>: a game
        that called your house and pulled you into a conspiracy. It got pulled —
        the tech wasn&apos;t there. Three things changed.
      </p>

      <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 sm:grid-cols-[10rem_1fr_1fr] sm:gap-x-5 sm:gap-y-3">
        {/* header row (desktop) */}
        <div className="hidden sm:block" />
        <div className="hidden font-mono text-[11px] uppercase tracking-[0.24em] text-white/40 sm:block">
          Majestic · 2001
        </div>
        <div
          className="hidden font-mono text-[11px] uppercase tracking-[0.24em] sm:block"
          style={{ color: COLOR.green }}
        >
          DEAD DROP · now
        </div>

        {rows.map((r) => (
          <RowGroup key={r.axis} {...r} />
        ))}
      </div>
    </Slide>
  );
}

function RowGroup({
  axis,
  then,
  now,
  accent,
}: {
  axis: string;
  then: string;
  now: string;
  accent: string;
}) {
  return (
    <>
      <div
        className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] sm:mt-0 sm:self-center"
        style={{ color: accent }}
      >
        {axis}
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-[13px] leading-snug text-white/55 sm:text-[15px]">
        <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.2em] text-white/30 sm:hidden">
          then
        </span>
        {then}
      </div>
      <div
        className="rounded-lg px-4 py-3 text-[13px] leading-snug text-white/90 sm:text-[15px]"
        style={{ border: `1px solid ${accent}44`, background: `${accent}10` }}
      >
        <span
          className="mb-1 block font-mono text-[9px] uppercase tracking-[0.2em] sm:hidden"
          style={{ color: accent }}
        >
          now
        </span>
        {now}
      </div>
    </>
  );
}

// ===========================================================================
// 3 — THE LOOP (the spine)
// ===========================================================================
function LoopSlide() {
  const nodes: FlowNode[] = [
    { tool: "Photon", label: "Inbound text / photo", accent: COLOR.sky },
    { tool: "Game", label: "Classify", accent: COLOR.green },
    { tool: "AI", label: "Verify (vision / GPS)", accent: COLOR.amber },
    { tool: "XTrace", label: "Read scoped memory", accent: COLOR.rose },
    { tool: "Game", label: "Advance game state", accent: COLOR.green },
    { tool: "XTrace", label: "Write facts + reconcile", accent: COLOR.rose },
    { tool: "AI", label: "Narrate (Handler)", accent: COLOR.amber },
    { tool: "Photon", label: "Deliver reply", accent: COLOR.sky },
  ];
  return (
    <Slide>
      <SlideHeading
        eyebrow="the spine"
        accent={COLOR.green}
        title={
          <>
            One inbound message → one Handler reply.{" "}
            <span style={{ color: COLOR.green }}>Deterministic on purpose.</span>
          </>
        }
      />
      <p className="mb-8 max-w-3xl text-sm leading-relaxed text-white/70 sm:text-lg">
        Every turn runs the same eight steps in-process, so a live demo never
        improvises into a corner. Transitions are{" "}
        <span className="text-white">code</span>; the prose is{" "}
        <span className="text-white">AI</span>, on rails.
      </p>

      <Panel className="overflow-x-auto">
        <FlowDiagram nodes={nodes} />
      </Panel>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniNote accent={COLOR.sky} title="Thin orchestrator">
          The webhook verifies an HMAC, normalizes the payload, runs the turn,
          and is the <em>only</em> place that sends.
        </MiniNote>
        <MiniNote accent={COLOR.amber} title="Verify, don&apos;t gate">
          Vision reads the photo and the Handler reacts to what it sees — no
          brittle pass/fail to stall on.
        </MiniNote>
        <MiniNote accent={COLOR.green} title="Never 500s">
          Every external call is wrapped; worst case is a safe in-character
          fallback line. The demo never dies.
        </MiniNote>
      </div>
    </Slide>
  );
}

function MiniNote({
  title,
  accent,
  children,
}: {
  title: ReactNode;
  accent: string;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-lg px-4 py-3"
      style={{ border: `1px solid ${accent}33`, background: `${accent}0c` }}
    >
      <div
        className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em]"
        style={{ color: accent }}
      >
        {title}
      </div>
      <p className="text-[12px] leading-snug text-white/70 sm:text-[13px]">
        {children}
      </p>
    </div>
  );
}

// ===========================================================================
// 4 — THE FOUR TOOLS
// ===========================================================================
function ToolsSlide() {
  return (
    <Slide>
      <SlideHeading
        eyebrow="four mandatory tools · load-bearing, not plumbing"
        accent={COLOR.blue}
        title="Every tool is doing visible work."
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ToolCard
          accent={COLOR.sky}
          name="Butterbase"
          role="the entire backend, no DevOps"
          points={[
            "Postgres: players · sessions · game_state · events · messages · facts · fact_log",
            "OpenAI-compatible AI gateway — Claude for narration + vision",
            "Realtime WebSockets drive the live mission-control dashboard",
            "Storage holds the proof photos; serverless ties it together",
          ]}
        />
        <ToolCard
          accent={COLOR.green}
          name="Photon / Spectrum"
          role="iMessage in & out — no app install"
          points={[
            "The player lives in their own Messages thread",
            "A photo arrives as an attachment GUID — no bytes",
            "The SDK pulls the bytes, converts HEIC → JPEG",
            "Claude vision then reads the banner in the shot",
          ]}
        />
        <ToolCard
          accent={COLOR.rose}
          name="XTrace"
          role="scoped, revisable memory"
          points={[
            "Implemented as a Butterbase facts table",
            "Scopes: world · player · handler-secret",
            "Reconciliation runs only within a (subject, scope) partition",
            "The planted Pier 7 lie lives in PLAYER scope — never auto-corrected",
          ]}
        />
        <ToolCard
          accent={COLOR.amber}
          name="RocketRide"
          role="the game-master pipeline"
          points={[
            "The classify → verify → memory → narrate → deliver loop",
            "Runs in-process so the critical path has zero deps",
            "A flag-gated adapter can consult a real RocketRide engine",
            "It returns null on any error — never on the critical path",
          ]}
        />
      </div>
    </Slide>
  );
}

function ToolCard({
  accent,
  name,
  role,
  points,
}: {
  accent: string;
  name: string;
  role: string;
  points: string[];
}) {
  return (
    <Panel accent={accent} className="!p-4 sm:!p-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3
          className="text-lg font-black tracking-wide sm:text-xl"
          style={{ color: accent }}
        >
          {name}
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/45 sm:text-[11px]">
          {role}
        </span>
      </div>
      <ul className="space-y-1.5">
        {points.map((p, i) => (
          <li
            key={i}
            className="flex gap-2 text-[12px] leading-snug text-white/80 sm:text-[13.5px]"
          >
            <span style={{ color: accent }} aria-hidden>
              ▸
            </span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ===========================================================================
// 5 — THE BRAIN (scoped memory, the headline)
// ===========================================================================
function BrainSlide() {
  const world: ScopeFact[] = [
    { text: "Cache hidden at the sponsor banner.", op: "ASSERT" },
    { text: "The courier is Mara Voss.", op: "ASSERT" },
    {
      text: "Real handoff: the loading dock behind the Old Mint.",
      op: "ASSERT",
      note: "world truth — never reaches into player scope",
    },
  ];
  const player: ScopeFact[] = [
    { text: "Recovered the cache.", op: "ASSERT" },
    {
      text: "Mara Voss is a clean courier.",
      op: "SUPERSEDE",
      struck: true,
    },
    {
      text: "Mara Voss is compromised — she made you.",
      op: "RECONCILE",
      fresh: true,
      note: 'reconciled in player scope: "clean" → "compromised"',
    },
    {
      text: "Believes the meeting point is the fountain at Pier 7.",
      op: "ASSERT",
      note: "the planted lie — stays lit",
    },
  ];
  const handler: ScopeFact[] = [
    { text: "Mara is burned; Pier 7 is a deliberate plant.", op: "ASSERT" },
    {
      text: "Do NOT correct the Pier 7 belief until the contradiction beat.",
      op: "ASSERT",
    },
  ];
  return (
    <Slide>
      <SlideHeading
        eyebrow="the headline idea · scoped memory"
        accent={COLOR.rose}
        title="A story that remembers — and keeps the lie you were told."
      />
      <p className="mb-5 max-w-4xl text-sm leading-relaxed text-white/70 sm:text-base">
        Three scopes, three partitions.{" "}
        <span style={{ color: COLOR.rose }}>Reconciliation</span> only ever fires{" "}
        <span className="text-white">inside</span> a{" "}
        <span className="font-mono text-white/90">(subject, scope)</span> partition.
        World truth lives in a different partition from the player&apos;s
        beliefs, so it can <span className="text-white">never</span> silently
        fix the lie — that gap is the drama.
      </p>

      {/* On phones the three scopes stack and grow with their content (the
          whole slide scrolls). Only on lg do they share a fixed-height row and
          scroll internally, as on the projector. */}
      <div className="grid grid-cols-1 gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-3">
        <ScopeColumn scope="world" facts={world} />
        <ScopeColumn scope="player" facts={player} />
        <ScopeColumn scope="handler" facts={handler} />
      </div>

      <p className="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-white/45 sm:text-[12px]">
        the player column is exactly what the projector shows — struck-through
        old belief, flashed-in new one, the Pier 7 lie still glowing
      </p>
    </Slide>
  );
}

// ===========================================================================
// 6 — THE 6-BEAT DEMO
// ===========================================================================
function DemoSlide() {
  const beats: {
    n: string;
    title: string;
    body: ReactNode;
    accent: string;
  }[] = [
    {
      n: "1",
      title: "Opener",
      body: "The phone rings (or a text lands). An operative — SABLE — went dark and left a cache. Recover it.",
      accent: COLOR.sky,
    },
    {
      n: "2",
      title: "Proof of presence",
      body: "The player photographs the sponsor banner into the blue-bubble thread. Vision reads it; it doubles as proof of location.",
      accent: COLOR.amber,
    },
    {
      n: "3",
      title: "The callback",
      body: (
        <>
          The Handler references what they just did, reveals courier{" "}
          <b className="text-white">Mara Voss</b>, and plants the{" "}
          <b style={{ color: COLOR.amber }}>Pier 7</b> lie. This proves the
          brain.
        </>
      ),
      accent: COLOR.rose,
    },
    {
      n: "4",
      title: "Contradiction",
      body: (
        <>
          New intel: Mara is burned. The old belief is reconciled live, and the
          player earns the <b style={{ color: COLOR.sky }}>HALCYON</b> fragment.
        </>
      ),
      accent: COLOR.rose,
    },
    {
      n: "5",
      title: "“What are you wearing?”",
      body: "The Handler asks for a visual ID. The answer lands on the dashboard — and the field actor reads it across the room.",
      accent: COLOR.green,
    },
    {
      n: "6",
      title: "The envelope",
      body: (
        <>
          A stranger walks up and hands over{" "}
          <b style={{ color: COLOR.amber }}>SEVEN</b>. HALCYON + SEVEN ={" "}
          <b className="text-white">HALCYON SEVEN</b>. Sign-off.
        </>
      ),
      accent: COLOR.green,
    },
  ];
  return (
    <Slide>
      <SlideHeading
        eyebrow="the demo · ~4 minutes, live in the room"
        accent={COLOR.green}
        title="Six beats. The city collapses into the demo room."
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {beats.map((b) => (
          <div
            key={b.n}
            className="flex gap-3 rounded-lg px-4 py-3.5"
            style={{
              border: `1px solid ${b.accent}3a`,
              background: `${b.accent}0c`,
            }}
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-black"
              style={{
                color: b.accent,
                border: `1px solid ${b.accent}66`,
                background: `${b.accent}14`,
              }}
            >
              {b.n}
            </div>
            <div>
              <div
                className="text-[14px] font-bold leading-tight sm:text-[15px]"
                style={{ color: b.accent }}
              >
                {b.title}
              </div>
              <p className="mt-1 text-[12px] leading-snug text-white/75 sm:text-[13px]">
                {b.body}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-5 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-white/40 sm:text-[12px]">
        every step has a safety net — manual override, GPS capture page, and
        full mock mode
      </p>
    </Slide>
  );
}

// ===========================================================================
// 7 — THE FINALE / WHY IT WINS
// ===========================================================================
function FinaleSlide() {
  return (
    <Slide className="items-center text-center">
      <Eyebrow color={COLOR.green} dot={COLOR.green} className="justify-center">
        the finale · why it wins
      </Eyebrow>

      <h2 className="mt-5 text-3xl font-black leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
        It steps out of the phone.
      </h2>

      <p className="mx-auto mt-6 max-w-3xl text-base leading-relaxed text-white/80 sm:text-xl">
        A stranger finds you across the room by a detail only the{" "}
        <span style={{ color: COLOR.amber }}>real player</span> could have given —
        and hands you an envelope. The game just left the screen.
      </p>

      <div className="mt-9 grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
        <WhyCard accent={COLOR.sky} title="No app, all phone">
          It lives in the Messages thread players already use.
        </WhyCard>
        <WhyCard accent={COLOR.rose} title="The world remembers">
          Scoped memory plants, contradicts, and rewrites — live on a projector.
        </WhyCard>
        <WhyCard accent={COLOR.green} title="One breath of reality">
          A stranger hands you the final clue. The room gasps.
        </WhyCard>
      </div>

      <p className="mx-auto mt-7 max-w-2xl text-sm leading-relaxed text-white/65 sm:text-base">
        <span style={{ color: COLOR.green }}>And it scales.</span> That stranger can
        be hired, not planted — <b className="text-white">RentAHuman</b> posts the
        handoff as a $5 bounty and a real courier shows up. One teammate today; any
        city, on demand, tomorrow.
      </p>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <LinkChip href="/dashboard" accent={COLOR.sky}>
          /dashboard
        </LinkChip>
        <LinkChip href="/capture" accent={COLOR.amber}>
          /capture
        </LinkChip>
        <a
          href="sms:+16282647656"
          className="rounded-lg px-5 py-3 font-mono text-sm tracking-wider transition-colors sm:text-base"
          style={{
            color: COLOR.green,
            border: `1px solid ${COLOR.green}55`,
            background: `${COLOR.green}10`,
          }}
        >
          Handler · +1 (628) 264-7656
        </a>
      </div>

      <div className="mt-10">
        <Wordmark className="text-2xl tracking-[0.3em] sm:text-3xl" />
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.34em] text-white/35">
          a phone rings · the world remembers · a stranger hands you an envelope
        </p>
      </div>
    </Slide>
  );
}

function WhyCard({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-lg px-4 py-4 text-left"
      style={{ border: `1px solid ${accent}3a`, background: `${accent}0c` }}
    >
      <div
        className="mb-1.5 text-[14px] font-bold sm:text-[15px]"
        style={{ color: accent }}
      >
        {title}
      </div>
      <p className="text-[12px] leading-snug text-white/75 sm:text-[13px]">
        {children}
      </p>
    </div>
  );
}

function LinkChip({
  href,
  accent,
  children,
}: {
  href: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="rounded-lg px-5 py-3 font-mono text-sm tracking-wider transition-colors sm:text-base"
      style={{
        color: accent,
        border: `1px solid ${accent}55`,
        background: `${accent}10`,
      }}
    >
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// The deck manifest: ordered slides + the accent that tints each one's glow +
// a short nav label for the dot-nav / section list.
// ---------------------------------------------------------------------------
export interface DeckSlide {
  id: string;
  label: string; // short nav label
  accent: string; // background glow tint
  render: () => ReactNode;
}

export const SLIDES: DeckSlide[] = [
  { id: "title", label: "Title", accent: COLOR.blue, render: () => <TitleSlide /> },
  { id: "hook", label: "The Hook", accent: COLOR.amber, render: () => <HookSlide /> },
  { id: "loop", label: "The Loop", accent: COLOR.green, render: () => <LoopSlide /> },
  { id: "tools", label: "Four Tools", accent: COLOR.blue, render: () => <ToolsSlide /> },
  { id: "brain", label: "The Brain", accent: COLOR.rose, render: () => <BrainSlide /> },
  { id: "demo", label: "6-Beat Demo", accent: COLOR.green, render: () => <DemoSlide /> },
  { id: "finale", label: "Why It Wins", accent: COLOR.green, render: () => <FinaleSlide /> },
];
