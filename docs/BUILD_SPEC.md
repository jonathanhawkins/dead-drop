# DEAD DROP — BUILD SPEC (single source of truth for the build swarm)

You are one agent in a swarm building a working hackathon demo. **Read this whole
file. Build ONLY the files assigned to your role. Code against the exact
signatures below so the pieces compile together.** Do not edit files owned by
another role. Do not edit `package.json`, `.env*`, `next.config.ts`,
`src/lib/env.ts`, `src/lib/types.ts`, `src/lib/butterbase.ts`, `src/lib/ai.ts`,
`docs/`, or any `scripts/_env.ts` — those are owned by the lead and already done.

## 0. What this is
A real-world ARG. A player texts a phone number; an LLM "Handler" runs them
through a spy mission, remembers everything in scoped memory, and the finale
steps out of the phone (a real person hands them an envelope). Four mandatory
tools: **Butterbase** (backend/DB/AI/realtime/storage), **Photon/Spectrum**
(iMessage+WhatsApp), **XTrace** (scoped memory — we implement its role as a
Butterbase `facts` table), **RocketRide** (pipeline — implemented in-process;
real adapter is a flag-gated bonus).

## 1. Verified environment & architecture (already true — don't re-derive)
- **Next.js 16 App Router + TypeScript + Tailwind v4 + (shadcn optional)**. `src/` dir, import alias `@/*`.
- Runs as a **persistent Node server** (NOT serverless): `npm run dev` (port `${PORT:-4317}`). Exposed publicly for the webhook + capture page via **cloudflared** tunnel (`npm run tunnel`).
- **MOCK flags**: `MOCK_AI` (default true in `.env.local`) returns canned AI; `MOCK_PHOTON` logs instead of sending. The whole loop must run with both mocked (so `npm run simulate` works with no phone/credits).
- **Server-only modules** (hold secrets): anything importing `@/lib/env`, `butterbase`, `ai`, `photon`, `memory`, `game`, `loop`, `voice`. NEVER import these into a client component. Client surfaces read `NEXT_PUBLIC_*` only.
- Env access is via `@/lib/env` (`env.butterbase.*`, `env.ai.*`, `env.photon.*`, `env.rocketride.*`, `env.voice.*`, `env.dashboard.overrideToken`, `env.port`, `env.publicBaseUrl`). Client code uses `process.env.NEXT_PUBLIC_*`.

## 2. The bedrock you build on (DONE & VERIFIED — just import these)

### `@/lib/types` (done)
Exports: `Scope` (`"world"|"player"|"handler-secret"`), `FactStatus`
(`"current"|"revised"|"superseded"`), `Fact`, `FactOp`
(`"assert"|"revise"|"supersede"|"reconcile"`), `FactLogRow`, `Beat`
(`"intro"|"cache_recovered"|"courier_lie"|"contradiction"|"finale_identify"|"solve"|"signed_off"`),
`BEAT_ORDER`, `Player`, `Session`, `GameState`, `InboundMessage`, `InboundKind`,
`Classification` (`"proof_presence"|"puzzle_answer"|"freeform"|"wrong_move"`),
`Verdict`, `HandlerReply`, `TurnResult`. (See the file for fields — use them verbatim.)

### `@/lib/butterbase` (done — PostgREST-ish data API, server-only)
```ts
dbSelect<T>(table, { filters?: {col:"eq.val"}, select?, order?:"created_at.desc", limit?, offset? }): Promise<T[]>
dbSelectOne<T>(table, opts): Promise<T|null>
dbInsert<T>(table, data): Promise<T>                       // returns the row
dbUpdate<T>(table, id, patch): Promise<T>                  // PATCH {table}/{id}
dbUpdateWhere<T>(table, filters, patch): Promise<T[]>      // select ids then update each
dbDelete(table, id): Promise<void>
dbDeleteWhere(table, filters): Promise<number>
storageUploadUrl(filename, contentType, sizeBytes, public?): Promise<{uploadUrl,objectId,...}>
storageDownloadUrl(objectId): Promise<string>
storageDownloadBytes(objectId): Promise<{bytes:Buffer, contentType:string}>
```
Filters are PostgREST operators as strings: `{ id: "eq.<uuid>" }`, `{ subject: "eq.world" }`, `{ status: "eq.current" }`. Order like `"created_at.desc"`.

### `@/lib/ai` (done — Butterbase AI gateway, server-only)
```ts
chat(messages, { model?, maxTokens?, temperature? }): Promise<string>
complete(system, user, opts?): Promise<string>            // narration; honors MOCK_AI
completeJSON<T>(system, user, fallback, opts?): Promise<T> // parses JSON; returns fallback on MOCK_AI/parse-fail
describeImage(prompt, { dataUrl?|bytes?, mime? }): Promise<string>   // vision; honors MOCK_AI
toJpegDataUrl(bytes, mime?): Promise<string>              // HEIC/any -> small jpeg data URL
```
Models: `env.ai.model` = `anthropic/claude-sonnet-4.6` (narration), `env.ai.visionModel` same (vision). Don't hardcode model ids; use env.

### Database tables (live; columns you'll use)
- `players(id, phone UNIQUE, handle, created_at)`
- `sessions(id, player_id, status, channel, handler_line, started_at, ended_at, created_at)`
- `game_state(id, session_id UNIQUE, player_id, beat, step, digital_fragment, final_answer, wearing, override_advance, updated_at, created_at)`
- `events(id, session_id, player_id, kind, payload jsonb, photo_object_id, verdict, created_at)`
- `messages(id, session_id, player_id, direction, channel, content_type, body, photon_message_id, attachment_guid, attachment_object_id, meta jsonb, created_at)`
- `facts(id, scope, subject, content, source, status, supersedes, session_id, created_at)`
- `fact_log(id, fact_id, op, scope, subject, content, note, session_id, created_at)` ← realtime-enabled (dashboard subscribes here). Also realtime on `messages`, `game_state`.

## 3. Verified external contracts

### Photon / Spectrum (iMessage + WhatsApp) — `spectrum-ts@1.18.0`
- Auth: HTTP Basic for REST (`PROJECT_ID`:`PROJECT_SECRET`). SDK: `Spectrum({ projectId, projectSecret, providers:[imessage.config()] })`.
- **No REST send** — sending uses the SDK: `const im = imessage(app); const space = await im.space(await im.user("+1...")); await space.send("text")`. Pin our line via `im.space(user, { phone: env.photon.handlerLine })` if supported.
- **Inbound photo = GUID only** (no URL/base64 in webhook). Pull bytes via SDK: `await im.getAttachment(content.id, space.phone)` then `.read()` → Buffer. Photos are often **HEIC** → convert with `ai.toJpegDataUrl(bytes, mime)`.
- Webhook payload (inbound): `{ event:"messages", space:{ phone }, message:{ id, direction:"inbound", sender:{ id }, content:{ type:"text", text } | { type:"attachment", id, name, mimeType, size } } }`. `sender.id` = player phone (reply target). `space.phone` = our line.
- Signature header `X-Spectrum-Signature: v0=<hex>` = HMAC-SHA256 of `v0:{timestamp}:{rawBody}` keyed by the webhook signing secret (`env.photon.webhookSigningSecret`). If the secret is empty, SKIP verification with a console.warn (dev mode).
- Tapbacks: `message.react("love"|"like"|"laugh"|"emphasize"|"question"|"dislike")`. Typing/`richlink` exist (best-effort; wrap in try/catch).

### AI gateway: `POST {env.butterbase.apiUrl}/chat/completions`, `Authorization: Bearer {serviceKey}`, OpenAI-compatible. (Already wrapped by `@/lib/ai` — just use that.)

### Realtime (browser): `wss://api.butterbase.ai/v1/{appId}/realtime?token={NEXT_PUBLIC_BUTTERBASE_REALTIME_TOKEN}`. After open, send `{type:"subscribe", table:"fact_log"}`. Receive `{type:"change", table, op:"INSERT"|"UPDATE"|"DELETE", record, old_record}`. Also `{type:"connected"|"subscribed"|"heartbeat"|"error"}`.

### Storage: presigned. `storageUploadUrl()` → PUT bytes to `uploadUrl` with matching Content-Type → persist `objectId`.

## 4. Canonical game design (use EXACTLY this content for coherence)

**Persona:** The Handler — terse, controlled, cinematic spymaster. 1–3 sentences per text. Never breaks character. References what the player actually just did. Theatrical, never threatening; there's a safe word "ABORT" that ends the game kindly.

**Canon (put in `@/lib/content.ts` as `CANON`):**
- operative codename: **SABLE** (went dark, left the cache)
- drop site: **the sponsor banner** (RocketRide/Butterbase banner in the room)
- courier name (revealed by the cache): **Mara Voss**
- the lie (planted, player-scope, NEVER auto-corrected): meeting point is **"the fountain at Pier 7"**
- real meeting point (world truth): **"the loading dock behind the Old Mint"**
- digital fragment (earned in-game): **HALCYON**
- envelope half (physical, handed by the actor): **SEVEN**
- final passphrase (fragment + envelope): **HALCYON SEVEN**

**Beats & deterministic transitions** (transitions are CODE, prose is AI — keeps the demo predictable but alive). `nextBeat(current, classification, verdict, override)`:
- `intro` + proof_presence(photo) → `cache_recovered`. Effects: write player facts `recovered the cache`, `learned courier name: Mara Voss`. Handler reacts to the photo (vision desc), reveals the name. Then plant the lie: write player fact `believes meeting point is the fountain at Pier 7 (false)`, advance to `courier_lie` next turn (or same message — see below).
- `cache_recovered`/`courier_lie` + any proof/text → `contradiction`. Effects: **reconcile within player scope** — supersede the earlier player belief `Mara Voss is a clean courier` (write it during cache_recovered) with `Mara Voss is compromised — she made you` (op=supersede/reconcile → visible on dashboard). Award fragment: write player fact `earned fragment: HALCYON`, set `game_state.digital_fragment="HALCYON"`. The world fact "real meeting point = Old Mint" stays in world scope and does NOT touch the Pier 7 lie (that gap is the drama). Handler ends by asking the finale question.
- `contradiction` + text → `finale_identify`. Handler: "For the final handoff I need to identify you. What are you wearing?"
- `finale_identify` + freeform(description) → `solve`. Effects: store description in `game_state.wearing` AND a player fact `wearing: <desc>`; set `game_state.final_answer="HALCYON SEVEN"`. Handler: "Hold position. My courier is moving to you." (Actor reads `wearing` off the dashboard, walks up, hands the envelope = SEVEN.)
- `solve` + puzzle_answer matching `HALCYON SEVEN` (case/space-insensitive, accept if contains both HALCYON and SEVEN) → `signed_off`. Handler signs off. Else nudge.
- Any beat + `override` (from dashboard) → advance to the next beat in `BEAT_ORDER` regardless. The manual override is the demo safety net.
- `wrong_move`/unclear → stay on beat, Handler nudges in-narrative (never a hard error/gate).

**Classification** (`classify(input, state)`): image → `proof_presence`; text that contains both HALCYON & SEVEN (or looks like the passphrase) → `puzzle_answer`; at `finale_identify`, any text → treat as the wearing description (`freeform`); short affirmations/arrival texts → `proof_presence` when a photo isn't required; "ABORT" → safe-word (handle as freeform with a kind sign-off). Keep it forgiving — when unsure, prefer to advance the story rather than stall. Use `completeJSON` only as a secondary signal; primary rules are deterministic.

**Reconciliation rule (critical):** only ever reconcile WITHIN one `(subject, scope)` partition. World truth must never silently correct a player's false belief. `memory.reviseBelief` enforces this.

## 5. File ownership & required exports (build your role's files ONLY)

### ROLE: photon — `src/lib/photon.ts`
Server-only. Singleton Spectrum app (lazy init, cached on `globalThis`). Honor `MOCK_PHOTON` (log + no-op). Exports:
```ts
export function verifyWebhookSignature(rawBody: string, headers: Headers): boolean   // true if valid OR secret empty (warn)
export function toInboundMessage(payload: any): InboundMessage                         // map Spectrum -> our shape (source:"photon")
export async function fetchAttachmentBytes(guid: string, handlerLine: string): Promise<{ bytes: Buffer; mime: string }>
export async function sendText(toPhone: string, text: string, opts?: { reactions?: string[]; typing?: boolean; channel?: "imessage"|"whatsapp" }): Promise<void>
export async function sendTyping(toPhone: string, on: boolean): Promise<void>          // best-effort, try/catch
```
Wrap all SDK calls in try/catch with console logging. If the SDK init throws (no connectivity), `sendText` should fall back to logging (so the demo never crashes on delivery).

### ROLE: brain — `src/lib/memory.ts`, `src/lib/content.ts`, `src/lib/game.ts`
Server-only. Imports `butterbase`, `ai`, `types`, `env`.
`memory.ts`:
```ts
export async function assertFact(a:{scope:Scope;subject:string;content:string;source:string;sessionId?:string}): Promise<Fact>
export async function reviseBelief(a:{scope:Scope;subject:string;newContent:string;source:string;sessionId?:string;match?:(f:Fact)=>boolean}): Promise<{superseded:Fact[];created:Fact}>
export async function readScope(subject:string, scope:Scope, status?:FactStatus): Promise<Fact[]>
export async function readPlayerMemory(playerId:string): Promise<{world:Fact[];player:Fact[]}>  // NOT handler-secret
export async function seedWorldFacts(sessionId?:string): Promise<number>   // idempotent-ish; from content.WORLD_FACTS
```
Every write mirrors to `fact_log` (op assert/supersede/reconcile, plus a human `note` on reconciliations). `reviseBelief` only supersedes `current` facts in the SAME (subject,scope).
`content.ts`: `export const CANON = {...}` (section 4), `export const HANDLER_PERSONA = "..."`, `export const WORLD_FACTS: {scope:Scope;subject:string;content:string;source:string}[]` (world + handler-secret), `export function narrationPrompt(beat, ctx): {system:string; user:string}`.
`game.ts`:
```ts
export async function classify(input: InboundMessage, state: GameState): Promise<Classification>
export function nextBeat(current: Beat, c: Classification, verdict: Verdict|undefined, override: boolean): Beat
export interface BeatOutcome { nextBeat: Beat; reply: HandlerReply; statePatch: Partial<GameState>; factsWritten: number; reconciled: boolean }
export async function runBeat(a:{ state: GameState; input: InboundMessage; classification: Classification; verdict?: Verdict; playerId: string; sessionId: string }): Promise<BeatOutcome>
```
`runBeat` does memory effects (via memory.ts) + narration (via ai.ts + content.ts) per the section-4 map and returns the reply + a `statePatch` (beat/step/digital_fragment/wearing/final_answer) for the caller to persist.

### ROLE: engine — `src/lib/loop.ts` + API routes + `scripts/simulate.ts`
Server-only. Imports `butterbase`, `ai`, `photon`, `memory`, `game`, `content`, `types`, `env`.
`loop.ts`:
```ts
export async function startSession(phone: string, handle?: string): Promise<{ player: Player; session: Session; state: GameState }>
   // upsert player by phone; create session + game_state(beat:"intro"); seed world facts (memory.seedWorldFacts).
export async function handleInbound(input: InboundMessage): Promise<{ reply: HandlerReply; turn: TurnResult }>
   // 1) dedupe on input.photonMessageId via messages table; 2) ensure player+session+state (auto-start if none);
   // 3) log inbound message; 4) if image: get bytes (input.imageDataUrl OR photon.fetchAttachmentBytes) -> ai.describeImage -> Verdict;
   //    if gps: simple Verdict; 5) game.classify; 6) memory.readPlayerMemory; 7) game.runBeat;
   //    8) persist statePatch to game_state; 9) log outbound message; 10) return reply (DOES NOT send — caller sends).
```
Routes (App Router `route.ts`, Node runtime — add `export const runtime = "nodejs"`):
- `src/app/api/photon/webhook/route.ts` — `POST`: read raw body; `photon.verifyWebhookSignature`; parse; if `event!=="messages"` or not inbound → 200 ack; `photon.toInboundMessage`; `loop.handleInbound`; then `photon.sendText(reply.text, {reactions, typing})`. Always return 200 quickly (catch errors → 200 to avoid Photon retries; log them).
- `src/app/api/session/start/route.ts` — `POST {phone, handle?}` → `loop.startSession` + fire `voice.placeOpeningCall` (don't await failure) → return ids.
- `src/app/api/override/route.ts` — `POST {sessionId, action:"advance"|"set_beat"|"mark_verified", beat?, token}`; check `token===env.dashboard.overrideToken`; advance `game_state.beat` (next in BEAT_ORDER) or set; write a `fact_log` note; return new state.
- `src/app/api/status/route.ts` — `GET ?sessionId=` → `{ state, player, facts: readPlayerMemory, recentMessages }`.
`scripts/simulate.ts` — import `loop`; run a scripted sequence (start session for a fake phone, then feed: a fake banner image via `imageDataUrl` (a tiny base64 jpeg or reuse mock), then texts driving each beat through to `HALCYON SEVEN`), printing each Handler reply + beat + facts written. Must work with `MOCK_AI=true MOCK_PHOTON=true`. This is the end-to-end test.

### ROLE: dashboard — `src/app/dashboard/page.tsx`, `src/lib/realtime-client.ts`, components under `src/components/dashboard/`
Client components (`"use client"`). `realtime-client.ts`: a small browser WS helper (connect, subscribe to `fact_log`+`messages`+`game_state`, reconnect on close, callback on change). Dashboard: projector view — three columns (world / player / handler-secret) of facts streaming in, reconciliations highlighted (op `supersede`/`reconcile` flash/strike-through old → new), the active player's **WEARING** shown huge for the actor, a live message ticker, and a control bar: "Start Session" (prompts phone, POST /api/session/start), "Advance Beat" + "Mark Verified" (POST /api/override with `process.env.NEXT_PUBLIC_OVERRIDE_TOKEN`... use a text input for the token, default from `process.env.NEXT_PUBLIC_OVERRIDE_TOKEN`). Use `NEXT_PUBLIC_BUTTERBASE_*`. Dark, high-contrast, "mission control" aesthetic. Must look great on a projector.
  (NOTE: add `NEXT_PUBLIC_OVERRIDE_TOKEN` usage; the lead will mirror the token into env. If unset, let the user type it.)

### ROLE: capture — `src/app/capture/page.tsx`, `src/app/api/capture/route.ts`, `src/app/api/capture/upload-url/route.ts`
Mobile-first client page (secure context). Requests geolocation; lets the user take/choose a photo; gets a presigned URL from `/api/capture/upload-url` (POST {filename, contentType, sizeBytes} → uses `storageUploadUrl`), PUTs the file, then POSTs `/api/capture` `{phone, gps:{lat,lng,accuracy}, photoObjectId}`. `/api/capture` logs an `events` row and (optionally) calls `loop.handleInbound` with an `InboundMessage{source:"capture", kind:"image", imageObjectId, gps}`. Show a clean "PRESENCE CONFIRMED" state. This is the GPS/HTTPS backup path for proof.

### ROLE: voice — `src/lib/voice.ts`
```ts
export const OPENER_SCRIPT: string
export async function placeOpeningCall(a:{ toPhone:string; playerHandle?:string }): Promise<{ ok:boolean; provider:string; detail?:string }>
```
`VOICE_PROVIDER=mock` → log the script + return ok (default). `twilio`/`vapi`/`elevenlabs` → real implementation guarded by missing-cred checks (return `{ok:false, detail:"no creds"}` gracefully). Never throw.

### ROLE: rocketride — `src/lib/rocketride/adapter.ts`, `pipelines/handler-loop.pipe`
Flag-gated bonus (`env.rocketride.enabled`, default false). `adapter.ts`:
```ts
export async function classifyViaRocketRide(input: InboundMessage): Promise<Classification | null>  // null if disabled/unreachable
export const rocketrideStatus: { enabled: boolean }
```
Use `rocketride` SDK (`new RocketRideClient({ auth, uri: env.rocketride.uri })`) connecting to a local engine; on ANY error return null (loop falls back to `game.classify`). `handler-loop.pipe` = a minimal webhook-source → agent → llm_anthropic → response pipeline (illustrative; cite in the README). NEVER on the critical path.

### ROLE: scaffold-content — `scripts/seed.ts`, `scripts/register-webhook.ts`, `src/app/page.tsx`
- `scripts/seed.ts`: import `memory.seedWorldFacts` (or content.WORLD_FACTS) and seed world+handler-secret facts; print a summary. `import "./_env"` first.
- `scripts/register-webhook.ts`: `import "./_env"`; POST `https://spectrum.photon.codes/projects/{PHOTON_PROJECT_ID}/webhooks/` with Basic auth (`PROJECT_ID:PROJECT_SECRET`) and body `{ webhookUrl: process.env.PUBLIC_BASE_URL + "/api/photon/webhook" }`; print the returned `signingSecret` and instruct to paste into `.env.local` as `PHOTON_WEBHOOK_SIGNING_SECRET`. Handle existing-webhook (list/delete) gracefully.
- `src/app/page.tsx`: a clean landing index — title DEAD DROP, the Handler number, links to `/dashboard` and `/capture`, a one-line status. Replace the default Next starter page.

### ROLE: docs — `README.md`, `docs/ARCHITECTURE.md`, `docs/DEMO_RUNBOOK.md`
README: what it is, the 4 tools and exactly how each is used, setup (`npm install`, `.env.local`, `npm run dev`, `npm run tunnel`, `npm run register-webhook`, `npm run simulate`), the demo runbook, and the fallbacks. Read the actual code to be accurate. ARCHITECTURE: the message-to-reply loop + scoped memory model. Keep it tight.

## 6. Conventions
- TypeScript strict. No `any` in exported signatures (internal `any` for SDK payloads is fine with a comment).
- API routes: `export const runtime = "nodejs";` and `export const dynamic = "force-dynamic";`.
- Wrap all external calls (Photon SDK, AI, fetch) in try/catch; the demo must degrade gracefully, never 500 on the webhook.
- Demo determinism: beat transitions in code; prose from AI. Manual override always works.
- Don't invent new env vars without noting them at the top of your file as `// NEEDS ENV: X`.
- Keep it shippable in a day. Working > clever.
