# DEAD DROP

**A real-world spy ARG that steps out of the phone.**

A player texts a phone number. An LLM "Handler" — a terse, cinematic spymaster —
runs them through a live espionage mission entirely over iMessage: find a cache
hidden on the sponsor banner in the room, photograph it as proof of presence,
learn a courier's name, get fed a deliberate lie, watch that lie get reconciled
against the truth, and finally combine a digital fragment (`HALCYON`) with a
physical one. The finale **steps out of the screen**: the Handler asks "what are
you wearing?", a real person reads the answer off a projector, walks up, and
hands the player an envelope marked `SEVEN`. Passphrase: **`HALCYON SEVEN`**.

Behind the scenes, every belief the player forms is written to **scoped memory**
and streamed live to a "mission control" dashboard — so the audience watches the
player's worldview get planted, contradicted, and rewritten in real time.

The whole thing runs locally with mocks (no phone, no credits) via
`npm run simulate`, and live via a public tunnel + a real iMessage line.

---

## The four mandatory tools (and exactly how each is used)

DEAD DROP is built on four sponsor tools. Here is precisely where each one lives
in this codebase. (A fifth integration, **RentAHuman**, recruits the real-world
field actor for the finale — see
[Recruiting the field actor](#recruiting-the-field-actor-rentahuman) below.)

### 1. Butterbase — backend, AI gateway, realtime, and storage

Butterbase is the entire backend. We use four of its surfaces:

- **Database** (`src/lib/butterbase.ts`) — a PostgREST-style data API over the
  service key. Tables: `players`, `sessions`, `game_state`, `events`,
  `messages`, `facts`, `fact_log`. Every player, session, message, proof event,
  and memory fact is a row here. Helpers: `dbSelect` / `dbSelectOne` /
  `dbInsert` / `dbUpdate` / `dbUpdateWhere` / `dbDelete` / `dbDeleteWhere`.
- **AI gateway** (`src/lib/ai.ts`) — an OpenAI-compatible
  `POST {apiUrl}/chat/completions` endpoint. It powers the Handler's narration
  (`complete`), a secondary message classifier (`completeJSON`), and **vision
  verification** of proof photos (`describeImage`, with `toJpegDataUrl`
  normalizing HEIC/any phone image to a small JPEG data URL). Model:
  `anthropic/claude-sonnet-4.6` (from `AI_MODEL` / `AI_VISION_MODEL`).
- **Realtime** (`src/lib/realtime-client.ts`) — the dashboard opens a browser
  WebSocket to `wss://api.butterbase.ai/v1/{appId}/realtime` and subscribes to
  `fact_log`, `messages`, and `game_state`. Every scoped-memory write, every
  text, and every beat change appears on the projector with no polling.
- **Storage** (`storageUploadUrl` / `storageDownloadBytes`) — the GPS/HTTPS
  capture page (`/capture`) mints a presigned upload URL, PUTs the proof photo
  straight to Butterbase storage, and the loop pulls the bytes back to feed the
  vision model.

### 2. Photon / Spectrum — iMessage (and WhatsApp) in & out

`src/lib/photon.ts` owns every call to the `spectrum-ts` SDK (lazy singleton
cached on `globalThis`, HMR-safe). It is the player's only channel:

- **Inbound webhook** (`POST /api/photon/webhook`) — verifies the
  `X-Spectrum-Signature` HMAC (`verifyWebhookSignature`), normalizes the payload
  to our `InboundMessage` shape (`toInboundMessage`), runs the turn, and sends
  the Handler's reply with `sendText`.
- **Outbound** — `sendText(toPhone, text, { reactions, typing, channel })` sends
  the reply, optionally preceded by a typing bubble and punctuated with iMessage
  tapbacks (love / emphasize / like).
- **Photo bytes** — an inbound photo arrives as a **GUID only**;
  `fetchAttachmentBytes(guid, handlerLine)` pulls the raw bytes via the SDK
  (`im.getAttachment(...).read()`), which the loop converts (often from HEIC)
  and hands to vision.
- **WhatsApp** — the same code path; set `PHOTON_CHANNEL=whatsapp` (or send via a
  WhatsApp space) and `toInboundMessage` / `sendText` route accordingly. This is
  the channel fallback if an iMessage line is unavailable.

`MOCK_PHOTON=true` makes every send a console log and skips the SDK entirely, so
the full loop runs with no Photon project or credits.

### 3. XTrace — scoped facts (implemented on Butterbase)

XTrace's role is **scoped, revisable memory**. We implement it as the Butterbase
`facts` table plus a `fact_log` realtime mirror, in `src/lib/memory.ts`. Three
scopes:

- `world` — objective truth (subject `"world"`).
- `player` — one operative's beliefs (subject = their `player_id`).
- `handler-secret` — the Handler's private intel (subject `"world"`).

The discipline that makes the demo sing: **`reviseBelief` only ever supersedes
`current` facts inside the *same* `(subject, scope)` partition.** World truth
*never* silently corrects a player's false belief — that gap (the planted
"fountain at Pier 7" lie vs. the world truth "loading dock behind the Old Mint")
is the drama. Every write — `assertFact` and `reviseBelief` — mirrors to
`fact_log` with an op (`assert` / `supersede` / `reconcile`) and a human-readable
`note`, which is exactly what the dashboard renders (struck-through old belief →
flashed-in new belief).

### 4. RocketRide — pipeline (in-process, plus a flag-gated real adapter)

The live message→reply pipeline runs **in-process** (`src/lib/loop.ts` →
`classify` → `runBeat`), so the critical path has zero external dependencies and
is fully deterministic. The *real* RocketRide integration is a **flag-gated
bonus** in `src/lib/rocketride/adapter.ts`: when `USE_ROCKETRIDE=true`, the loop
can optionally consult a `rocketride@1.2` client connected over WebSocket to a
local engine running `pipelines/handler-loop.pipe`
(`webhook → agent → llm_anthropic → response`) to classify an inbound message.
It returns `null` on disabled-or-any-error (with a 60s cooldown and 2.5–6s
timeouts), so the loop transparently falls back to the in-process classifier.
**It is never on the critical path and never throws.**

---

## Recruiting the field actor (RentAHuman)

The finale "steps out of the phone" when a real person hands the player the
`SEVEN` envelope. On stage that person is a **planted teammate** (the safe
default). **RentAHuman** is the "how it scales" beat: instead of a teammate, you
post a bounty and an actual stranger on-site accepts it, receives the envelope,
and is pointed at the player in real time by their live "what are you wearing?"
description. Everyone in the scene still knows it's a game (per the craft rules).

`src/lib/rentahuman.ts` is **server-only** (it holds the API key) and wraps
`POST https://rentahuman.ai/api/bounties`, authed with header
`X-API-Key: rah_...`.

How the money works:

- **Posting a bounty is FREE.** `createBounty()` publishes an open listing and
  charges nothing.
- **The price is only escrowed when you accept an applicant** (default **$5**).
  So you can post the courier listing live with zero cost and only pay once you
  hire the stranger who shows up.
- A **`dryRun`** flag previews the exact payload with **no side effects** — no
  listing created, no charge.

Lib exports:

- `createBounty(input)` — create (or, with `dryRun:true`, preview) a bounty.
  Never throws; returns `{ ok, dryRun, bounty?, error? }`.
- `getBounty(id)` — fetch a bounty's status.
- `listApplications(id)` — list the humans who applied.
- `handoffBounty({ price?, venue?, deadline? })` — the canonical DEAD DROP finale
  courier bounty (hand off a sealed envelope in ~5 min, identified by what the
  player is wearing).

Two commands (env var: `RENTAHUMAN_API_KEY=rah_...`, optional
`RENTAHUMAN_API_BASE`):

```bash
npx tsx scripts/post-handoff.ts                 # DRY RUN — preview only, nothing posted, no charge
LIVE=true npx tsx scripts/post-handoff.ts       # actually publish the bounty (still $0 until you accept someone)
PRICE=5 VENUE="Agentic AI SF Hackathon" LIVE=true npx tsx scripts/post-handoff.ts   # overrides
```

See [`docs/RENTAHUMAN.md`](docs/RENTAHUMAN.md) for the full walk-through.

---

## How it fits together (one turn)

```
 iMessage ──▶ POST /api/photon/webhook
                 │  verify HMAC, normalize → InboundMessage
                 ▼
            loop.handleInbound()                         [src/lib/loop.ts]
                 │  dedupe · ensure player+session+game_state (auto-start)
                 │  log inbound message
                 │  if photo → pull bytes (Photon) → vision Verdict (AI)
                 │  game.classify()  (deterministic; AI/RocketRide secondary)
                 ▼
            game.runBeat()                               [src/lib/game.ts]
                 │  nextBeat() — PURE, deterministic spine
                 │  memory effects: assertFact / reviseBelief  ─┐
                 │  narration: ai.complete(narrationPrompt(...)) │
                 ▼                                                ▼
            persist game_state          facts + fact_log ──▶ Butterbase realtime
                 │                                                │
                 ▼                                                ▼
   webhook sends reply via photon.sendText            /dashboard (projector)
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full loop + the scoped
memory model, and [`docs/DEMO_RUNBOOK.md`](docs/DEMO_RUNBOOK.md) for the 6-beat
live run.

---

## Setup

Requirements: **Node 20+**, npm, and (for the live demo) a public HTTPS tunnel.
The project is **Next.js 16 (App Router) + TypeScript (strict) + Tailwind v4**.

### 1. Install

```bash
npm install
```

### 2. Configure `.env.local`

```bash
cp .env.example .env.local
```

Then fill it in. The variables that matter:

| Variable | Purpose |
| --- | --- |
| `PORT` | Dev server port (default **4317**). |
| `PUBLIC_BASE_URL` | Your public HTTPS tunnel URL (set after `npm run tunnel`). |
| `BUTTERBASE_APP_ID` / `BUTTERBASE_API_URL` / `BUTTERBASE_API_BASE` | Butterbase app + data API. |
| `BUTTERBASE_SERVICE_KEY` | **Server-only** key (bypasses RLS). Never expose. |
| `NEXT_PUBLIC_BUTTERBASE_APP_ID` / `..._API_URL` / `..._API_BASE` | Same values, exposed to the dashboard client. |
| `NEXT_PUBLIC_BUTTERBASE_REALTIME_TOKEN` | Realtime token for the projector dashboard (trusted screen). |
| `AI_MODEL` / `AI_VISION_MODEL` | `anthropic/claude-sonnet-4.6`. |
| `MOCK_AI` | `true` while developing — returns canned narration/vision, spends no credits. |
| `PHOTON_PROJECT_ID` / `PHOTON_PROJECT_SECRET` | Photon/Spectrum project (HTTP Basic). |
| `PHOTON_HANDLER_LINE` | Our iMessage line, E.164 (e.g. `+16282647656`). |
| `PHOTON_CHANNEL` | `imessage` (default) or `whatsapp`. |
| `PHOTON_WEBHOOK_SIGNING_SECRET` | Printed by `register-webhook`; empty ⇒ signature check is skipped (dev). |
| `MOCK_PHOTON` | `true` ⇒ logs instead of sending; no Photon project needed. |
| `DASHBOARD_OVERRIDE_TOKEN` | Token the `/api/override` route requires. |
| `NEXT_PUBLIC_OVERRIDE_TOKEN` | Mirror of the above; pre-fills the dashboard's token field. Keep the two equal. |
| `VOICE_PROVIDER` | `mock` (default) / `twilio` / `vapi` / `elevenlabs` for the opening call. |
| `USE_ROCKETRIDE` | `false` (default). `true` enables the bonus RocketRide classifier. |
| `RENTAHUMAN_API_KEY` | `rah_...` key for posting the finale courier bounty (server-only). Optional `RENTAHUMAN_API_BASE`. Only needed for the live RentAHuman option. |

> The demo runs end-to-end with **`MOCK_AI=true MOCK_PHOTON=true`** and only the
> Butterbase keys set. Everything else is needed only for the live phone demo.
>
> Note: `.env.example` ships the server-side `DASHBOARD_OVERRIDE_TOKEN`; for the
> dashboard control bar to pre-fill its token, also set
> `NEXT_PUBLIC_OVERRIDE_TOKEN` to the same value (already present in `.env.local`).

### 3. Run

```bash
npm run dev        # Next.js dev server on http://localhost:4317
```

- Landing page: <http://localhost:4317/>
- Mission-control dashboard (projector): <http://localhost:4317/dashboard>
- Field capture / GPS backup: <http://localhost:4317/capture>

### 4. Seed the world facts

```bash
npm run seed       # writes world + handler-secret facts into scoped memory (idempotent)
```

(`startSession` also seeds on first contact, so this is optional — but it makes
the dashboard's WORLD and HANDLER·SECRET columns populated before the demo.)

### 5. Smoke-test the whole arc (no phone, no credits)

```bash
MOCK_AI=true MOCK_PHOTON=true npm run simulate
```

This drives one player through every beat — proof photo → cache → contradiction
→ identify → solve → sign-off — printing each Handler reply, the beat transition,
and how many scoped facts each turn wrote. It asserts the arc lands on
`signed_off` with the passphrase `HALCYON SEVEN`. **If this passes, the spine is
wired correctly.**

### 6. Go live (real iMessage)

```bash
npm run tunnel             # cloudflared → public HTTPS URL; paste it into PUBLIC_BASE_URL
npm run register-webhook   # registers the Spectrum webhook; prints the signing secret
# → paste PHOTON_WEBHOOK_SIGNING_SECRET into .env.local, set MOCK_PHOTON=false, restart `npm run dev`
```

Now text the `PHOTON_HANDLER_LINE` from a real phone and the Handler replies.

### Other scripts

```bash
npm run reset              # wipe all game rows between rehearsals (keeps schema)
npm run verify:bedrock     # sanity-check the Butterbase/AI bedrock is reachable
npm run build / npm start  # production build / serve
```

---

## Fallbacks (the demo never dies)

Every external call is wrapped in `try/catch`; the webhook **never 500s** (a bad
signature is the only non-200, returning 401). The graceful-degradation paths:

- **Manual override** — the dashboard control bar can force the story forward:
  **Advance Beat** (`/api/override` `action:advance`) steps to the next beat,
  **Mark Verified** (`action:mark_verified`) makes the *next* inbound
  auto-advance. This is the primary safety net if a live phone hiccups; overrides
  also write a note to `fact_log` so they show on the projector. (Requires the
  override token.)
- **GPS / HTTPS capture page** (`/capture`) — if iMessage photo delivery is
  flaky, the player opens the tunnel URL, locks GPS, snaps the banner, and the
  photo goes through Butterbase storage instead. Drives the exact same loop and
  shows a "PRESENCE CONFIRMED" screen. A photo *or* a GPS fix alone counts as
  presence.
- **`MOCK_AI`** — canned narration + vision; the arc still advances with zero AI
  spend.
- **`MOCK_PHOTON`** — sends become logs; run the full loop with no Photon
  project. (`npm run simulate` relies on this.)
- **WhatsApp** — `PHOTON_CHANNEL=whatsapp` reroutes the same Handler over
  WhatsApp if iMessage is unavailable for a player.
- **Opening voice call** — fired fire-and-forget on session start; if the
  provider has no creds or fails, it logs and the text mission proceeds anyway.
  `VOICE_PROVIDER=mock` just prints the script.
- **AI / DB unavailable mid-turn** — `handleInbound` returns a safe in-character
  fallback line ("Hold position, operative…") so the player still hears from the
  Handler and the webhook still acks 200.

---

## Project layout

```
src/lib/
  types.ts            shared domain types (Scope, Beat, Fact, InboundMessage, …)
  env.ts              typed, server-only environment access
  butterbase.ts       Butterbase data API + storage (DB)
  ai.ts               Butterbase AI gateway: narration + vision (AI)
  photon.ts           Spectrum SDK: webhook verify, inbound map, send, attachment bytes
  memory.ts           XTrace-role scoped facts + fact_log mirror (memory)
  content.ts          CANON, Handler persona, world facts, narrationPrompt
  game.ts             classify · nextBeat (deterministic) · runBeat (memory + narration)
  loop.ts             handleInbound / startSession — the orchestrator
  voice.ts            cinematic opening call (mock / twilio / vapi / elevenlabs)
  realtime-client.ts  browser WS client for the dashboard
  rocketride/adapter.ts   flag-gated RocketRide classifier (bonus)
  rentahuman.ts       RentAHuman bounty API: recruit the finale courier (server-only)
src/app/
  page.tsx            landing index (Handler number + links)
  dashboard/page.tsx  mission control (projector)
  capture/page.tsx    GPS/HTTPS proof backup
  api/photon/webhook  inbound front door (the only place that sends)
  api/session/start   start a mission + opening call
  api/override        manual beat override (safety net)
  api/status          session snapshot for the dashboard
  api/capture[/upload-url]   capture-page proof + presigned upload URL
pipelines/handler-loop.pipe  illustrative RocketRide pipeline (bonus)
scripts/              simulate · seed · register-webhook · reset · verify:bedrock · post-handoff (RentAHuman)
```

Safe word: text **`ABORT`** at any time and the Handler ends the mission kindly.
