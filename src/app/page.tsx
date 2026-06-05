// DEAD DROP — landing index. Public, client-safe surface (no server secrets).
// The Handler number is meant to be texted by players, so it's shown in the
// clear as a tappable sms: link. Server component (no interactivity needed).

// The public Handler line. Display form + dialable E.164 (matches
// env.photon.handlerLine = "+16282647656"). Safe to hardcode: it's the number
// players are supposed to message.
const HANDLER_NUMBER_DISPLAY = "+1 (628) 264-7656";
const HANDLER_NUMBER_E164 = "+16282647656";

export const metadata = {
  title: "DEAD DROP",
  description:
    "A real-world spy ARG. Text the Handler. Recover the cache. Make the drop.",
};

export default function Home() {
  return (
    <main
      className="flex flex-1 flex-col items-center justify-center px-6 py-16 font-mono text-zinc-100"
      style={{
        background:
          "radial-gradient(1200px 600px at 50% -10%, #14532d22, transparent), #050608",
      }}
    >
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        {/* Eyebrow / status line */}
        <div className="mb-8 flex items-center gap-2 text-[11px] uppercase tracking-[0.35em] text-emerald-400/80">
          <span
            className="inline-block h-2 w-2 rounded-full bg-emerald-400"
            style={{ boxShadow: "0 0 10px 2px rgba(52,211,153,0.8)" }}
            aria-hidden
          />
          channel open
        </div>

        {/* Title */}
        <h1
          className="text-5xl font-bold uppercase tracking-[0.25em] text-white sm:text-7xl"
          style={{ textShadow: "0 0 28px rgba(52,211,153,0.25)" }}
        >
          DEAD DROP
        </h1>

        <p className="mt-5 max-w-md text-sm leading-relaxed text-zinc-400">
          An operative went dark and left a cache in this room. The Handler is
          waiting. Make contact, prove you&apos;re on site, and recover what
          SABLE left behind.
        </p>

        {/* The Handler number — the primary call to action */}
        <a
          href={`sms:${HANDLER_NUMBER_E164}`}
          className="mt-10 block w-full rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-6 py-6 transition-colors hover:border-emerald-400/60 hover:bg-emerald-500/[0.1]"
        >
          <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-400/70">
            Text the Handler
          </div>
          <div className="mt-2 text-3xl font-semibold tracking-wider text-white sm:text-4xl">
            {HANDLER_NUMBER_DISPLAY}
          </div>
          <div className="mt-2 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            iMessage &middot; tap to begin
          </div>
        </a>

        {/* Secondary navigation */}
        <nav className="mt-8 flex w-full flex-col gap-3 sm:flex-row">
          <a
            href="/deck"
            className="flex flex-1 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/[0.06] px-5 py-3 text-sm uppercase tracking-[0.2em] text-sky-200 transition-colors hover:border-sky-400/60 hover:bg-sky-500/[0.1]"
          >
            Deck
          </a>
          <a
            href="/dashboard"
            className="flex flex-1 items-center justify-center rounded-lg border border-zinc-700/70 bg-zinc-900/60 px-5 py-3 text-sm uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800/80"
          >
            Mission Control
          </a>
          <a
            href="/capture"
            className="flex flex-1 items-center justify-center rounded-lg border border-zinc-700/70 bg-zinc-900/60 px-5 py-3 text-sm uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800/80"
          >
            Confirm Presence
          </a>
        </nav>

        <footer className="mt-12 text-[10px] uppercase tracking-[0.3em] text-zinc-600">
          safe word: <span className="text-zinc-400">ABORT</span> &middot; ends
          the mission
        </footer>
      </div>
    </main>
  );
}
