# DEAD DROP — Product Requirements Document
### Agentic AI SF Hackathon build

**Working title:** DEAD DROP
**One-liner:** A real-world alternate reality game that infiltrates your phone, sends you on missions, remembers everything you do, and ends with a stranger handing you an envelope.

It is the game EA tried to build in 2001 with Majestic and could not, because the tech was not there. The agents were canned recordings with no memory and no ability to adapt. An LLM agent is the live character that could not exist then. Photon is the phone-call-and-text delivery that cost EA twenty million dollars, now a single API. XTrace is the part Majestic never had at all: a story that remembers what you uncovered, who you talked to, what you lied about, and rewrites itself as you poke at it.

---

## 1. The pitch in one breath

Your phone rings. A Handler tells you an operative went dark in this part of the city and left a dead drop. You go recover it. As you move, the Handler texts you, the world reacts to what you actually do, and the mystery deepens. The finale steps out of the phone: the Handler asks what you are wearing, and a real person walks up and hands you the final clue.

Players never install an app. The game lives in the Messages or WhatsApp thread they already use. The only thing we ship to the phone is a one-page web capture for GPS backup.

---

## 2. The demo (stage runbook)

This is the thing that wins the room. Everything else exists to make this run live. Target length is about four minutes. The city is collapsed into the demo room.

**Pre-stage (before we go up):**
- A sponsor banner (RocketRide or Butterbase) is visible in the room and serves as the first drop site.
- One teammate is the field actor, holding a sealed envelope.
- A second screen or projector shows the XTrace memory dashboard for the active player, updating live through Butterbase Realtime.
- World facts pre-seeded in XTrace (the courier's name, the real meeting point, the lie).
- The opening phone call is queued and ready to fire on cue.

**Beat 1, the call (about 30s).**
A volunteer or judge gives us their number. Their phone rings. Twilio plus a Vapi or ElevenLabs voice agent plays the Handler: an operative went dark, recover the cache. This is the Majestic "it plays you" opening, live in the room.

**Beat 2, proof of presence through iMessage (about 30s).**
The player walks to the sponsor banner, photographs it, and sends the photo into the blue-bubble thread. This single move does two jobs at once: it shows the iMessage texting working, and it proves location. A vision model reads the photo. GPS via the one-page web capture is the silent backup path.

**Beat 3, the callback that proves the brain (about 60s). THIS IS THE MONEY MOMENT.**
The Handler texts back through Photon, into the player's real Messages thread, and references what they just did, then adds a twist: the cache held a name, but the courier they spoke to lied about the meeting point. On the projector, the XTrace dashboard updates with new facts written under this player. This is the beat that makes XTrace read as a brain and not a database.

**Beat 4, second loop with a contradiction (about 45s).**
Another short mission, another proof, and this time new intel revises something the player believed earlier. The dashboard shows the old belief getting reconciled against the new truth. The self-revising memory shown on purpose, not by accident.

**Beat 5, the finale, stepping out of the phone (about 45s).**
The Handler asks: for the final handoff I need to identify you, what are you wearing? The player texts back something like "blue jacket, by the window." Photon delivers it, XTrace stores it under that player, and the field actor reads it off the dashboard, walks straight to the player, and hands over the envelope without a word.

**Beat 6, the solve (about 30s).**
The envelope holds the physical half of the final clue. The digital half is a fragment the player already earned earlier. The two halves click together into the final answer. The player texts it in, the Handler signs off.

**What the judges just watched:** a real phone ring, a sponsor's own banner photographed into a normal Messages thread, live text delivery, a memory dashboard updating turn by turn, and a stranger finding the player by a detail only the real-world player could have provided. Every mandatory tool was visibly doing work.

---

## 3. Proof of presence: photo through iMessage

We are dropping the 3D-printed trinket. It is the most likely thing not to finish in time, and the photo path is both faster to build and a better demo beat. The physical dimension does not disappear, because the envelope finale still carries it. The arc stays intact: digital all the way through, one breath of reality at the end.

**How it works:**
- The player photographs a known target (a sponsor banner for the demo, curated landmarks for the real game) and sends it through iMessage.
- A vision model describes the photo. We verify by content, not by a hard yes/no gate.
- GPS via the one-page web capture is the silent backup if a photo is ambiguous.
- The dashboard has a manual override: if vision face-plants on stage, a teammate taps advance and nobody in the room knows.

**Why this is the safe end of vision.**
Recognizing a known sponsor logo is closer to logo detection than open-ended scene understanding. We control the reference image, the banner is large and high-contrast and well-lit, and we will have shot it from the same angle in rehearsal. That is a very different risk profile from "is this person standing at Pier 39." Bonus: photographing a sponsor's banner puts their brand in the demo, and sponsors are often the judges.

**The one rule that de-risks it.**
Do not gate on a binary. Have the Handler describe what it sees: "Good, that is the RocketRide banner behind you, you are in the right sector, the cache is close." If we gate on pass/fail and the model misfires, the demo stalls. If the agent reacts to the photo's contents, there is no brittle gate to fail, and "it can see where I am" reads smarter than a checkmark.

---

## 4. The iMessage moment, and a Photon caveat

The photo-into-the-thread beat is the core iMessage moment, so we do not need to manufacture a separate one. Beyond that, a few iMessage textures would sell "this is alive, not an SMS bot."

**Caveat first:** we do not yet know exactly which iMessage features Photon exposes. Check the Photon docs before building toward any of these. Design around the safe bets, treat the rest as bonus.

- **Safe bets:** inbound images (the player's photo) and link previews.
- **Bonus if Photon surfaces them:** the typing indicator (the dot-dot-dot bubble before the Handler replies, which is pure thriller tension) and tapbacks. If they are available, use them. If not, blue bubbles plus the inbound photo still carry it.

---

## 5. Tech stack

**App and frontend**
- Next.js 15 (App Router), React, TypeScript
- TailwindCSS, shadcn/ui
- Two surfaces: the one-page mobile web capture (GPS backup, photo upload fallback) and the XTrace memory dashboard (projector view)

**Backend: Butterbase**
- PostgreSQL with declarative JSON schema (diff and apply)
- JWT auth, plus row-level security for per-player data
- S3-compatible file storage via presigned URLs (proof photos)
- Serverless TypeScript functions (HTTP triggers, cron)
- AI model gateway, OpenAI-compatible, used to call Claude for narration and vision
- Realtime over WebSockets, which drives the live dashboard
- Frontend deployment to a live HTTPS URL. This matters: browser camera and GPS require a secure context, so the capture page must be served over HTTPS.

**Pipeline and agent: RocketRide**
- TypeScript SDK (`npm install rocketride`)
- Pipelines are portable JSON in the `*.pipe` format, each starting with a source node. We use the webhook source node for inbound messages.
- Engine runs locally or via Docker (`ghcr.io/rocketride-org/rocketride-engine`, port 5565)
- Built-in multi-agent support and 13 LLM providers if we want them

**Memory: XTrace**
- Memory API for scoped facts. XTrace is the agent's source of truth for what it knows.

**Messaging: Photon**
- iMessage for the demo (best read in a US room), WhatsApp as the reliable fallback

**Voice: Twilio plus Vapi or ElevenLabs**
- Outbound call for the opening Handler beat

**Dev workflow**
- Butterbase ships an MCP server and a Claude Code plugin, so Claude Code can provision the backend from prompts.
- RocketRide is coding-agent ready and auto-detects Claude.

---

## 6. Architecture: the message-to-reply loop

The spine, one turn start to finish:

1. **Inbound.** Photon delivers a player text or photo to a Next.js API route (the thin orchestrator). The route logs the message to Butterbase.
2. **Invoke the pipeline.** The route calls the RocketRide pipeline through the TypeScript SDK. (Alternative: point Photon's webhook straight at RocketRide's webhook source node. We route through Next.js for easier debugging and logging.)
3. **Classify.** Pipeline decides: proof of presence, puzzle answer, freeform chat, or wrong move.
4. **Verify.** If it is a photo, call the vision model (Claude via the Butterbase gateway) and verify by content, narrative not gated. If GPS, check against the expected site.
5. **Read memory.** Pull this player's scope from XTrace plus relevant world facts.
6. **Advance state.** Update game progress in Butterbase. Write new facts to XTrace under the player scope, and run reconciliation. Mirror each fact write into a Butterbase `fact_log` row so the dashboard can show it in realtime (XTrace stays the agent's memory, the mirror is just the display tap).
7. **Decide the next beat.** The narration model generates the Handler's next move from memory plus state.
8. **Deliver.** Send the beat back through Photon, or trigger a Twilio plus Vapi or ElevenLabs call.

---

## 7. XTrace memory model (scoped facts)

A flat shared memory leaks. The agent will narrate something a player could not know, or fumble the twist three beats early. Real ARG memory is scoped, and getting the scopes right is the design.

**Scopes:**
- **world:** objective truth. The cache is at the banner. The courier's name is X. The real meeting point is Y.
- **player:** what this specific player has done and learned. Recovered the cache, talked to the courier, believes the meeting point is Z (false), is wearing a blue jacket.
- **handler-secret:** plot the Handler holds that the player has not earned yet.

**The key rule:** reconcile contradictions within a scope, not across scopes. When a player learns the real meeting point, that updates the player scope and reconciliation does its job. But when a player has been lied to and believes something false, world-truth must not silently correct that belief, because the gap between what they think is true and what is actually true is the drama. The lie that has not caught up yet is the entire point.

**A fact looks like:**
```
{
  id:        unique id
  scope:     world | player | handler-secret
  subject:   player_id, or "world"
  content:   the fact itself
  source:    which message, photo, or call produced it
  timestamp: when
  status:    current | revised | superseded
}
```

Reconciliation runs inside each partition (subject plus scope), not across the whole store.

---

## 8. Build plan, as Claude Code phases

Each phase below is written as a self-contained task you can hand to Claude Code. Do them in order. Each has a Done when you can verify before moving to the next. Do not start a phase until the one before it passes its check. Get the loop closing end to end before any polish.

### Phase 0, repo and backend scaffold
- **Goal:** a running Next.js app wired to a live Butterbase backend.
- **Do:** scaffold Next.js 15 App Router with TypeScript, Tailwind, and shadcn/ui. Install the Butterbase TypeScript SDK. Use the Butterbase MCP server or Claude Code plugin to create the app, then store `app_id`, API base URL, and keys in env.
- **Done when:** the app runs locally and the SDK can write and read one test row in Butterbase.

### Phase 1, data model
- **Goal:** the schema the game runs on.
- **Do:** define a declarative JSON schema for `players`, `sessions`, `game_state`, `events` (proof submissions), `messages` (inbound and outbound log), and `fact_log` (the realtime mirror of XTrace writes). Enable row-level security on player-owned tables. Preview with dry-run, then apply.
- **Done when:** all tables exist, CRUD works over the data API, and RLS keeps one player from reading another's rows.

### Phase 2, Photon messaging loop
- **Goal:** prove text in, text out. The single most important phase. If this does not work, nothing else matters.
- **Do:** build a Next.js API route to receive Photon inbound. Log the message to Butterbase. Send a hardcoded reply back through Photon. No game logic yet.
- **Done when:** you text the number from a real phone and get the reply in iMessage or WhatsApp.

### Phase 3, capture web page (GPS backup)
- **Goal:** the secure-context backup path for proof of presence.
- **Do:** build one mobile-first Next.js route with shadcn that requests geolocation and can also upload a photo to Butterbase storage via a presigned URL, tagged with a session token. Deploy it through Butterbase frontend deployment so it is served over HTTPS.
- **Done when:** opening the deployed page on a phone returns coordinates and lands an uploaded photo in storage tied to a session.

### Phase 4, RocketRide game loop pipeline
- **Goal:** the pipeline that turns a player message into the Handler's next move.
- **Do:** build a `*.pipe` with a webhook source node. Wire the stages: classify input, branch to verify, read XTrace, advance Butterbase state, write XTrace, decide the next beat with an LLM node or the Butterbase gateway, output the beat. Invoke it from the Phase 2 route through the RocketRide TypeScript SDK.
- **Done when:** a real player message runs the full pipeline and produces the correct next beat for the current state.

### Phase 5, vision verification (narrative, not gated)
- **Goal:** photo-into-iMessage proves location without a brittle gate.
- **Do:** in the verify stage, when an image arrives, call Claude vision through the Butterbase gateway to describe it. Have the Handler react to the contents in-narrative. Add a confidence note but never a hard pass/fail block.
- **Done when:** a photo of the sponsor banner produces a Handler reply that references the banner naturally, and a non-matching photo produces a nudge rather than a stall.

### Phase 6, XTrace scoped memory and reconciliation
- **Goal:** the brain.
- **Do:** integrate the XTrace Memory API. Write facts with scope tags (world, player, handler-secret) and subject. Read the player scope plus world facts each turn. Implement one scripted contradiction so reconciliation visibly fires. Mirror every write into `fact_log`.
- **Done when:** facts accumulate per player across turns, one contradiction reconciles on cue, and the mirror row appears in Butterbase.

### Phase 7, the memory dashboard (projector)
- **Goal:** the audience can watch the brain work.
- **Do:** build a Next.js dashboard page in shadcn that subscribes to Butterbase Realtime on `fact_log`, shows the active player's facts updating live, highlights a reconciliation when it happens, and exposes the manual override control (advance, mark verified).
- **Done when:** facts appear in real time as the player plays, and the override button advances state without a code change.

### Phase 8, voice bookend (the opener)
- **Goal:** the phone rings and the game begins.
- **Do:** wire Twilio plus Vapi or ElevenLabs to place an outbound call delivering the Handler's opening mission. Trigger it from the dashboard at session start.
- **Done when:** starting a session rings the target phone and plays the opener.

### Phase 9, the envelope finale
- **Goal:** the step out of the phone.
- **Do:** add the "what are you wearing" beat. Store the player's description under their scope in XTrace and surface it prominently on the dashboard for the actor. Define the final answer as the earned digital fragment plus the envelope contents, and accept it when the player texts it in.
- **Done when:** the description shows on the dashboard, the actor can read it, and the correct final answer triggers the Handler's sign-off.

### Phase 10, rehearse and harden
- **Goal:** a clean four-minute run.
- **Do:** run the full demo three times. Confirm every fallback: manual override, GPS backup, pre-cached capture page, queued opening call, WhatsApp fallback if iMessage delivery is flaky.
- **Done when:** the demo runs start to finish without intervention, and every fallback works when forced.

---

## 9. Scope: what we build vs what we stage

The failure mode is building four cool fragments that do not connect by demo time. We build one vertical slice all the way through (Phases 0 through 10) and stage everything else.

**Stage or mock (describe in the pitch, do not build):**
- Multiple cities.
- A web-search or Yelp clue engine that adapts to nearby venues. If we want any dynamic content, web search is the safer route, and even then keep it off the critical path. Do not scrape Yelp live: flaky and against their terms.
- rentahuman.ai for the live actor. The demo actor is a planted teammate. rentahuman is the how-it-scales story.
  - **NOTE: now implemented — see `src/lib/rentahuman.ts` (and `scripts/post-handoff.ts`). Supersedes "do not build": posting the finale courier bounty is built; the planted teammate remains the safe default.**
- Full multi-episode campaign. We build one episode arc.
- Payments and subscriptions. Butterbase supports Stripe Connect, but mock it in test mode if shown at all.
- Native iOS or Android. We are deliberately not building this. Photon plus a web capture page is the design.

**Cut entirely:** the 3D-printed trinket, and Composio. We are already stacking Twilio plus a voice provider on top of four mandatory tools. Protect the mandatory four.

---

## 10. Risks and craft rules

**Vision on the critical path.** We are knowingly putting a vision model on the proof beat. It is acceptable only because it is logo detection on a controlled target, it is narrative not gated, GPS is the backup, and the dashboard has a manual override. Keep all four nets in place.

**Demo determinism.** Hand-curate the target and pre-seed world facts. Nothing on the critical path should depend on a live external fetch.

**Venue connectivity.** Phone signal in demo rooms is unreliable. Pre-cache the capture page, queue the opening call, keep a wifi fallback for messaging, and have WhatsApp ready if iMessage delivery stalls.

**The scare line.** The best ARGs thrill the player without frightening a real person, and never make a non-consenting bystander the target. Majestic got pulled partly because the intrusion started to feel genuinely threatening. Keep any scare theatrical and bounded, make sure everyone in a scene knows they are in a game, and give players an opt-out word. Exhilarating but never endangering.

**Do not over-integrate.** Four mandatory tools plus Twilio plus a voice provider is a full plate. Resist anything that steps on the mandatory four.

---

## 11. Submission checklist

- [ ] Working prototype (live demo of the vertical slice).
- [ ] Source code repository link.
- [ ] Project description: the problem, how each of the four tools is used, and how they are woven together.
- [ ] Pitch deck or video (optional).
- [ ] Connect to Butterbase before starting (dashboard.butterbase.ai, promo code in billing).
- [ ] Final submission line pasted into the agent with the correct submission code and hackathon slug.

---

## Appendix: why this is the right idea for this team

An ARG is level design for the real world. That is a craft most teams in the room cannot touch, and it is the thing to lean on. The four tools stop being plumbing and become load-bearing: Photon because the player is mobile and lives in their thread, XTrace because a mystery is the cleanest self-revising-memory domain there is, RocketRide because the game-master loop is a genuine pipeline, and Butterbase because it carries the whole backend, the realtime dashboard, and the HTTPS capture page with no DevOps. The demo wins on a feeling, not a spec: a phone rings, the world remembers, and a stranger hands you an envelope.
