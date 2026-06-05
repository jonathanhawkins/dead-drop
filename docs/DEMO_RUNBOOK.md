# DEAD DROP — Demo Runbook

The live, on-stage script. One operator on the projector laptop (dashboard +
overrides), one volunteer player with a phone, one actor with the envelope.
Target run time: ~4–6 minutes.

> **Golden rule:** the **manual override** is always available. If a text is slow
> or a photo doesn't land, hit **Advance Beat** / **Mark Verified** on the
> dashboard and keep moving. The story must never stall on stage.

---

## Cast & props

- **Operator** — runs `/dashboard` on the projector; can Start Session, Advance
  Beat, Mark Verified.
- **Player** — a volunteer with an iPhone (or any phone for WhatsApp). Texts the
  Handler line.
- **Actor / courier** — stands to the side with a small envelope. Inside (or
  written on it): **`SEVEN`**. **Default: a planted teammate** (rehearsed, the
  safe choice). **Live/scale option:** recruit a real stranger on-site via
  **RentAHuman** (see "The handoff" beat below) so the courier is someone the
  player has never met — the "how it scales" beat. Everyone in the scene still
  knows it's a game.
- **The drop site** — the **sponsor banner** in the room (RocketRide /
  Butterbase). That's what the player photographs.
- **The canon** (operator should know it cold):
  - operative who went dark: **SABLE**
  - courier: **Mara Voss**
  - the lie fed to the player: meet at **the fountain at Pier 7**
  - the world truth (never told to the player): **the loading dock behind the
    Old Mint**
  - digital fragment (earned): **HALCYON** · envelope half (handed over):
    **SEVEN** · final passphrase: **HALCYON SEVEN**
  - safe word: **ABORT**

---

## Pre-flight (before the audience)

1. **Bring up the server.** `npm run dev` (port 4317). Confirm `/`, `/dashboard`,
   `/capture` all load.
2. **Tunnel + webhook (live mode).**
   - `npm run tunnel` → copy the `https://…trycloudflare.com` URL into
     `PUBLIC_BASE_URL` in `.env.local`.
   - `npm run register-webhook` → paste the printed
     `PHOTON_WEBHOOK_SIGNING_SECRET` into `.env.local`.
   - Set `MOCK_PHOTON=false` (and `MOCK_AI=false` for real Handler prose), then
     **restart `npm run dev`** so env changes take effect.
3. **Seed + clean slate.** `npm run reset` then `npm run seed` so the dashboard's
   **WORLD** and **HANDLER·SECRET** columns are populated and no stale player
   facts linger.
4. **Open the projector.** Load `/dashboard`. Paste the override token into the
   **token** field (it pre-fills from `NEXT_PUBLIC_OVERRIDE_TOKEN`). Confirm the
   realtime dot is **green** ("realtime open").
5. **Dry run (highly recommended).** In a terminal:
   `MOCK_AI=true MOCK_PHOTON=true npm run simulate` — it should print the full arc
   and end with ✅ on `signed_off` / `HALCYON SEVEN`. This proves the spine end to
   end with zero spend.
6. **Brief the actor:** when the **WEARING** panel lights up green with a
   description, read it, walk to that person, hand them the envelope, say nothing.
7. **(Optional) Recruit a real courier via RentAHuman.** To run the live/scale
   option instead of the planted teammate, preview the bounty first, then publish:
   ```bash
   npx tsx scripts/post-handoff.ts                                 # DRY RUN — preview, free, nothing posted
   PRICE=5 VENUE="Agentic AI SF Hackathon" LIVE=true npx tsx scripts/post-handoff.ts   # publish (still $0 until you accept)
   ```
   Needs `RENTAHUMAN_API_KEY=rah_...` set. Posting is **free**; the $5 is escrowed
   **only when you accept** an applicant. When someone on-site applies, accept
   them, hand them the envelope, and brief them exactly like the actor above
   (read the WEARING panel, walk up, hand it over). **If anything is uncertain,
   fall back to the planted teammate — that's always the safe default.**

---

## The 6-beat live run

Each beat: what the player does → what the audience sees on the projector → the
operator's safety net.

### Beat 0 — Activation (the opening call)

- **Operator:** click **▶ Start Session**, enter the player's phone (E.164) and
  an optional codename. This fires the cinematic **opening voice call**
  (`VOICE_PROVIDER`; `mock` just logs the script) and opens the mission at beat
  `intro`.
- **Player's phone rings** (live providers) or the operator reads the opener:
  *"This line is secure… one of ours went dark. Codename SABLE… find the cache…
  photograph it and send it to this number."*
- **Projector:** the beat rail highlights **INTRO**; WORLD + HANDLER·SECRET
  columns already show the seeded truth.

### Beat 1 — Proof of presence → CACHE RECOVERED

- **Player:** texts the Handler line and **sends a photo of the sponsor banner**.
- **Behind the scenes:** Photon delivers the photo (GUID) → loop pulls the bytes
  → Butterbase **vision** describes the banner → classified `proof_presence` →
  beat advances to `cache_recovered`.
- **Handler replies** (references what the photo shows), reveals the courier
  **Mara Voss**, and names the meeting point as **the fountain at Pier 7**
  (knowingly feeding cover). A **love** tapback lands on the player's photo.
- **Projector — the PLAYER column fills in:** "recovered the cache", "learned the
  courier: Mara Voss", "Mara Voss is a clean courier", and the **planted lie**
  "believes the meeting point is the fountain at Pier 7". Note the WORLD column
  still says the real point is the **Old Mint** — the gap is now visible.
- **Safety net:** no photo arriving? Use the **`/capture` page** (player opens the
  tunnel URL, locks GPS, snaps the banner) — same result. Or operator hits
  **Mark Verified**, and the player's next text auto-advances.

### Beat 2 — The twist → CONTRADICTION (the headline moment)

- **Player:** sends any reply ("Cache recovered, heading to Pier 7").
- **Behind the scenes:** beat advances to `contradiction`; `reviseBelief`
  **supersedes only** "Mara Voss is a clean courier" → "Mara Voss is compromised
  — she made you", strictly within the player's own partition. The fragment
  **HALCYON** is awarded.
- **Handler replies:** reverses the picture — Mara is burned, Pier 7 was a plant,
  here's your fragment **HALCYON** — and asks the finale question: *"For the
  handoff I need to identify you. What are you wearing?"*
- **Projector — the money shot:** the reconcile banner fires, the old "clean
  courier" belief gets **struck through**, the new "compromised" belief **flashes
  in** on the PLAYER column. Point out: world truth never touched the Pier 7 lie —
  the contradiction was a deliberate revision in the player's scope.
- **Safety net:** **Advance Beat** if needed.

### Beat 3 — Identify → IDENTIFY

- **Player:** answers what they're wearing ("black jacket, white shirt, by the
  window"). At `finale_identify`, **any** text is taken as the description.
- **Behind the scenes:** beat advances to `solve`; the description is stored in
  `game_state.wearing` and as a player fact; `final_answer` is set to
  **HALCYON SEVEN**.
- **Projector:** the **WEARING** panel blows the description up **huge** in green.

### Beat 4 — The handoff steps out of the phone → HANDOFF

- **Handler replies:** *"Hold position. My courier is moving to you."*
- **Courier:** reads the WEARING panel, walks across the room to that person, and
  **hands them the envelope (`SEVEN`)** in silence. This is the gasp moment — the
  game just left the screen.
  - **Default — planted teammate** (rehearsed, reliable).
  - **Live/scale option — RentAHuman stranger:** if you posted and accepted a
    bounty in pre-flight step 7, the courier is a real person who has never met
    the player. Same move: they read the player's live `wearing` description off
    the WEARING panel and walk it over. This is the literal "how it scales" beat —
    the planted teammate becomes a stranger hired on demand. **If the bounty
    didn't fill or anything's shaky, the planted teammate covers it — always the
    safe default.**
- **Handler** (already sent): tells the player to **combine their fragment with
  whatever the courier hands them** (it never says `SEVEN` or the full passphrase
  itself).

### Beat 5 — Solve → SIGNED OFF

- **Player:** texts the passphrase **`HALCYON SEVEN`** (case/space-insensitive;
  accepted as long as it contains both words).
- **Behind the scenes:** classified `puzzle_answer` → beat advances to
  `signed_off`.
- **Handler replies:** confirms the handoff, commends the operative, and signs
  off for good (a **like** tapback). Beat rail hits **SIGNED OFF**.
- **Safety net:** wrong/partial passphrase just holds on `solve` with a nudge;
  operator can **Advance Beat** to force the sign-off.

---

## Fallback cheat-sheet (operator)

| Situation | Do this |
| --- | --- |
| Text/photo slow or missing | Dashboard → **Advance Beat** (one beat) or **Mark Verified** (next inbound auto-advances). |
| iMessage photo won't deliver | Player opens **`/capture`** (tunnel URL), locks GPS, snaps the banner. Same loop. |
| No phone / rehearsing | `MOCK_AI=true MOCK_PHOTON=true npm run simulate` runs the whole arc in the terminal. |
| iMessage unavailable for a player | Set `PHOTON_CHANNEL=whatsapp` and run over **WhatsApp**. |
| AI prose feels flat / saving credits | `MOCK_AI=true` — canned but coherent Handler lines; arc still advances. |
| Opening call fails / no telephony | `VOICE_PROVIDER=mock` logs the script; the text mission proceeds regardless. |
| Player wants out | They text **`ABORT`** — the Handler stands them down warmly and ends the mission. |
| RentAHuman bounty didn't fill / courier no-show | Use the **planted teammate** for the handoff — always the safe default. (Posting was free; you only pay on accept.) |
| Dashboard columns empty mid-show | Paste the **session id** into the control bar's session field; realtime + `/api/status` rehydrate. |
| Realtime dot not green | Check `NEXT_PUBLIC_BUTTERBASE_*` (app id + realtime token); the client auto-reconnects with backoff. |

---

## Reset between runs

```bash
npm run reset      # wipe players/sessions/game_state/messages/events/facts/fact_log
npm run seed       # re-seed world + handler-secret facts
```

Then reload `/dashboard`. Each player uses a distinct phone number (the simulator
generates a fresh `+1555…` per run), so back-to-back demos don't collide.

---

## One-glance flow

```
Start Session (opening call)
      ▼
Player photographs the banner ──▶ vision verdict ──▶ CACHE RECOVERED
      ▼                                              (player beliefs + the Pier 7 lie appear)
Player replies ──▶ CONTRADICTION  (clean→compromised reconciled live; fragment HALCYON)
      ▼
"What are you wearing?" ──▶ IDENTIFY ──▶ WEARING blown up on the projector
      ▼
Courier (planted teammate, or a RentAHuman stranger) reads it, walks up,
        hands over the envelope (SEVEN) ──▶ HANDOFF
      ▼
Player texts HALCYON SEVEN ──▶ SIGNED OFF
```
