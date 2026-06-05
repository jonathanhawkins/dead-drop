# DEAD DROP — Architecture

Two ideas carry the whole build: **a deterministic message-to-reply loop** (so a
live demo is predictable) and **scoped, revisable memory** (so the audience
watches a worldview get rewritten). Everything else is plumbing around those two.

Stack: Next.js 16 App Router, TypeScript (strict), Tailwind v4, run as a
**persistent Node server** (not serverless) so the Spectrum SDK singleton and
in-process pipeline live for the process lifetime.

---

## 1. The message-to-reply loop

### Entry points → one normalized shape

Three sources can start a turn, and they all converge on a single
`InboundMessage` (`src/lib/types.ts`) so the loop only ever sees one shape:

| Source | Path | Becomes |
| --- | --- | --- |
| iMessage / WhatsApp | `POST /api/photon/webhook` → `photon.toInboundMessage` | `source:"photon"` |
| GPS/HTTPS backup | `/capture` → `POST /api/capture` | `source:"capture"` |
| Local simulator | `scripts/simulate.ts` | `source:"simulator"` |

```ts
interface InboundMessage {
  source: "photon" | "simulator" | "capture";
  channel: "imessage" | "whatsapp";
  photonMessageId?: string;   // dedupe key
  fromPhone: string;          // the player (E.164)
  handlerLine: string;        // our line
  kind: "text" | "image";
  text?: string;
  attachmentGuid?: string;    // iMessage photo → bytes pulled via SDK
  imageObjectId?: string;     // capture-page photo in Butterbase storage
  imageDataUrl?: string;      // inline (simulator / tests)
  gps?: { lat; lng; accuracy? };
  receivedAt: string;
}
```

### `loop.handleInbound(input)` — one turn (`src/lib/loop.ts`)

The orchestrator. It **computes and returns** the reply but **does not send** —
the webhook route is the only place that calls `photon.sendText`. Steps:

1. **Dedupe** on `photonMessageId` (Photon retries webhooks) via the `messages`
   table. A duplicate returns a blank-text reply → the caller sends nothing.
2. **Ensure** player + active session + `game_state` (auto-starts at beat `intro`
   on first contact; also seeds world facts). Same code as the explicit
   `startSession`.
3. **Log** the inbound `messages` row (best-effort).
4. **Verdict** for proof inbounds — a *note, never a gate*:
   - photo → pull bytes (`photon.fetchAttachmentBytes` for iMessage,
     `storageDownloadBytes` for capture, or inline `imageDataUrl`) →
     `ai.toJpegDataUrl` → `ai.describeImage` → `Verdict` carrying the vision
     description that grounds the Handler's prose;
   - gps → a simple positional `Verdict`.
   The proof is also logged to the `events` table.
5. **Classify** (`game.classify`) → one of
   `proof_presence | puzzle_answer | freeform | wrong_move`.
6. **Read** the player's scoped memory (for the `TurnResult`).
7. **Run the beat** (`game.runBeat`) → memory effects + narration → reply +
   `statePatch`.
8. **Persist** `statePatch` to `game_state` (beat / step / digital_fragment /
   wearing / final_answer).
9. **Log** the outbound `messages` row.
10. **Return** `{ reply, turn }`.

Every step is wrapped: a failed read, write, vision call, or AI call degrades to
a logged warning and (worst case) a safe in-character fallback reply. **The
webhook never 500s.**

### `game.classify` — deterministic first, AI second (`src/lib/game.ts`)

Primary rules are pure code; the AI is only a tie-breaker for genuinely ambiguous
text (and returns the fallback under `MOCK_AI`, so it is never load-bearing):

- safe word `ABORT` → `freeform` (handled as a kind exit; never mistaken for the
  passphrase);
- any image / attachment / capture / GPS-only ping → `proof_presence`;
- text containing **both** `HALCYON` and `SEVEN` → `puzzle_answer`;
- at beat `finale_identify`, **any** text → `freeform` (it's the wearing answer);
- short arrival pings at `intro` ("here", "in position", …) → `proof_presence`;
- otherwise → forgiving `freeform`.

Design rule: when unsure, **advance the story rather than stall**. There is no
hard error path — the Handler nudges in-narrative instead.

> Bonus: with `USE_ROCKETRIDE=true`, `loop` may consult
> `rocketride/adapter.classifyViaRocketRide` first; it returns `null` on
> disabled/any-error so `game.classify` always wins the fallback. Off the
> critical path by design.

### `game.nextBeat` — the deterministic spine (PURE)

```
intro ──proof──▶ cache_recovered ──any──▶ contradiction ──any──▶ finale_identify
   │                                                                    │
   │                                                              any text
   ▼                                                                    ▼
 (stay)                                            solve ──HALCYON SEVEN──▶ signed_off
```

`BEAT_ORDER` is `intro, cache_recovered, courier_lie, contradiction,
finale_identify, solve, signed_off`. The live arc jumps `cache_recovered →
contradiction` on the next contact; `courier_lie` is a distinct, reachable beat
used by the manual override (`set_beat`) when you want to dwell on the planted
lie before breaking it. A dashboard **override** always advances exactly one beat
in `BEAT_ORDER`, regardless of classification — the demo's safety net.

### `game.runBeat` — memory effects + narration

For the *target* beat (only when the beat actually moves), `runBeat` applies the
section-4 memory effects (below) and then asks the AI for prose:
`content.narrationPrompt(beat, ctx)` builds a `{system, user}` pair — the system
is the fixed Handler persona + canon; the user carries the per-turn goal plus
what the player just did (their text, the vision description, their current
beliefs). Transitions are code; **prose is AI, but on-rails.** If the AI is
unavailable, a deterministic `fallbackLine` per beat keeps the Handler talking.

The returned `statePatch` is persisted by the caller; the `reply` (text, beat,
tapbacks, typing flag) is sent by the webhook route.

---

## 2. Scoped memory (the XTrace role)

Implemented on Butterbase: a `facts` table + a `fact_log` realtime mirror
(`src/lib/memory.ts`). This is the heart of the demo.

### The model

```
Fact { id, scope, subject, content, source, status, supersedes?, session_id?, created_at }
  scope:  "world" | "player" | "handler-secret"
  status: "current" | "revised" | "superseded"
```

Three **partitions**, keyed by `(subject, scope)`:

| Scope | Subject | Holds |
| --- | --- | --- |
| `world` | `"world"` | objective truth — incl. the real meeting point. |
| `player` | the `player_id` | one operative's beliefs — incl. the planted lie. |
| `handler-secret` | `"world"` | the Handler's private intel; never auto-corrects a player. |

### The one rule that creates the drama

`reviseBelief` reads and supersedes **only `current` facts in the same
`(subject, scope)` partition**. World truth lives in a *different* partition from
the player's beliefs, so it can never reach over and silently fix a lie. The
contradiction is therefore a *deliberate* act inside the player's own partition,
not an accident of the data:

- At `cache_recovered` the loop asserts (player scope): "recovered the cache",
  "learned courier Mara Voss", "Mara Voss is a clean courier", and the **planted
  lie** "believes the meeting point is the fountain at Pier 7".
- At `contradiction`, `reviseBelief` supersedes *only* "…clean courier" with
  "Mara Voss is compromised — she made you", and awards the fragment `HALCYON`.
  The world fact "real meeting point = Old Mint" and the Pier 7 lie both stand —
  that gap is the point.

### Every write is observable

`assertFact` and `reviseBelief` mirror to `fact_log` with an op
(`assert` / `supersede` / `reconcile`) and, on reconciliations, a human-readable
`note` ("reconciled 1 belief in player/…: \"clean courier\" → \"compromised\"").
`fact_log` is realtime-enabled, so the dashboard renders each write live:
struck-through old belief, flashed-in new belief, accent rail on the reconcile.

`readPlayerMemory(playerId)` returns `{ world, player }` **current** facts only —
deliberately excluding `handler-secret`, so the Handler keeps the operative one
beat behind the truth. `seedWorldFacts()` writes `content.WORLD_FACTS` once
(idempotent on `(scope, subject, content)`).

---

## 3. The realtime dashboard (projector)

`/dashboard` is client-only and reads `NEXT_PUBLIC_*` exclusively (no server
secrets). `realtime-client.ts` opens **one** WebSocket to
`wss://api.butterbase.ai/v1/{appId}/realtime?token=…`, subscribes to `fact_log`,
`messages`, and `game_state`, and auto-reconnects with backoff + a heartbeat
watchdog. `useDashboardState` folds every change into:

- three scoped **fact columns** (world / player / handler-secret), with
  supersede/reconcile striking the old line and flashing the new;
- a **reconcile banner** for the headline moment;
- the **WEARING panel** — the operative's `game_state.wearing` blown up huge for
  the field actor to read across the room;
- a **message ticker**;
- a **control bar**: Start Session, Advance Beat, Mark Verified (override token,
  default from `NEXT_PUBLIC_OVERRIDE_TOKEN`).

`/api/status?sessionId=` provides a one-shot snapshot so the columns aren't empty
if the operator opens the dashboard mid-mission; realtime then carries the show.

---

## 4. Server/client boundary & failure posture

- **Server-only** (hold secrets, never imported into a client component):
  `env`, `butterbase`, `ai`, `photon`, `memory`, `game`, `content`, `loop`,
  `voice`, `rocketride/adapter`, `rentahuman`. Each guards with a `typeof window`
  check.
- **Client**: the dashboard, capture page, landing page, and `realtime-client`
  read `NEXT_PUBLIC_*` only.
- **API routes** export `runtime = "nodejs"` and `dynamic = "force-dynamic"`.
- **Mocks**: `MOCK_AI` (canned narration/vision) and `MOCK_PHOTON` (log instead
  of send) let the entire loop run with no phone and no spend.
- **Degradation**: every external call (Spectrum SDK, AI gateway, fetch, WS) is
  wrapped in `try/catch`; the webhook returns 200 even on internal error (401
  only on a bad signature) so Photon never retry-storms.

---

## 5. Recruiting the finale courier (RentAHuman)

The handoff actor is normally a planted teammate. **RentAHuman**
(`src/lib/rentahuman.ts`, server-only — holds the `RENTAHUMAN_API_KEY`) is the
optional "how it scales" path: it posts a bounty to
`POST https://rentahuman.ai/api/bounties` (`X-API-Key: rah_...`) so a real
stranger on-site can accept, take the envelope, and be pointed at the player by
their live `wearing` description. It sits entirely **outside the message loop** —
recruitment happens once at the finale, driven from a script
(`scripts/post-handoff.ts`), not from `handleInbound`. Economics: **posting is
free** (`createBounty`), and the price (default $5) is **escrowed only on
accept**, with a `dryRun` flag to preview the payload with no side effects.
Exports: `createBounty`, `getBounty`, `listApplications`, and the canonical
`handoffBounty()`.

---

## 6. Data model (Butterbase tables)

```
players(id, phone UNIQUE, handle, created_at)
sessions(id, player_id, status, channel, handler_line, started_at, ended_at, created_at)
game_state(id, session_id UNIQUE, player_id, beat, step,
           digital_fragment, final_answer, wearing, override_advance, updated_at, created_at)
events(id, session_id, player_id, kind, payload jsonb, photo_object_id, verdict, created_at)
messages(id, session_id, player_id, direction, channel, content_type, body,
         photon_message_id, attachment_guid, attachment_object_id, meta jsonb, created_at)
facts(id, scope, subject, content, source, status, supersedes, session_id, created_at)
fact_log(id, fact_id, op, scope, subject, content, note, session_id, created_at)   ← realtime
```

Realtime is enabled on `fact_log`, `messages`, and `game_state` — the three feeds
the dashboard subscribes to.
