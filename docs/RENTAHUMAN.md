# DEAD DROP — Recruiting the field actor (RentAHuman)

The DEAD DROP finale "steps out of the phone": a real person walks up to the
player and hands them the `SEVEN` envelope. On stage that person is a **planted
teammate** — rehearsed, reliable, the safe default.

**RentAHuman** is the *"how it scales"* beat. Instead of a teammate, you post a
bounty and an actual stranger who is on-site accepts it, receives the envelope,
and is pointed at the player in real time by the player's own live "what are you
wearing?" description. The planted teammate becomes a courier hired on demand.

Everyone in the scene still knows it's a game — this matches the PRD's craft
rules (theatrical, bounded, no non-consenting bystander is ever the target).

> **The planted teammate is always the safe default.** RentAHuman is the
> live/scale option. If a bounty doesn't fill or a courier no-shows, fall back to
> the teammate and the demo is unaffected.

---

## How it works

`src/lib/rentahuman.ts` is **server-only** (it holds the API key) and wraps the
RentAHuman bounty API:

- **Endpoint:** `POST https://rentahuman.ai/api/bounties`
- **Auth:** header `X-API-Key: rah_...`
- **Env:** `RENTAHUMAN_API_KEY` (the `rah_...` key); optional
  `RENTAHUMAN_API_BASE` to override the base URL.

### The economics (why this is low-risk)

- **Posting a bounty is FREE.** `createBounty()` publishes an open listing and
  charges **nothing**.
- **The price is escrowed only when you ACCEPT an applicant** (default **$5**,
  fixed). You can post the courier listing live at zero cost and only pay once
  you hire the specific stranger who shows up.
- A **`dryRun`** flag previews the exact request payload with **no side effects**
  — no listing is created and nothing is charged. Use it to sanity-check the
  copy before going live.

---

## Library exports (`src/lib/rentahuman.ts`)

| Export | Purpose |
| --- | --- |
| `createBounty(input)` | Create — or, with `input.dryRun:true`, preview — a bounty. **Never throws**; returns `{ ok, dryRun, bounty?, error?, raw? }`. |
| `getBounty(id)` | Fetch a bounty (status, etc.). Returns the raw JSON. |
| `listApplications(id)` | List the humans who applied to a bounty. Returns the raw JSON. |
| `handoffBounty({ price?, venue?, deadline? })` | Build the **canonical DEAD DROP finale courier bounty** — a `BountyInput` for a ~5-minute envelope hand-off, where the courier is told whom to find by what the player is wearing. |

`createBounty` returns `{ ok: false, error: "RENTAHUMAN_API_KEY not set" }` when
the key is missing, so it degrades quietly rather than crashing.

The `handoffBounty()` listing defaults: `price: 5`, `priceType: "fixed"`,
`evidenceTypes: ["photo", "text"]`, `spotsAvailable: 1`, and a description that
tells the courier they'll be handed a sealed envelope and pointed at the player
in real time by their clothing (e.g. *"pink shirt, white hat, center stage"*).

---

## The two commands (`scripts/post-handoff.ts`)

The script previews or publishes the canonical finale courier bounty.

```bash
# DRY RUN — preview only, nothing posted, no charge
npx tsx scripts/post-handoff.ts

# Actually publish the bounty (still $0 until you accept someone)
LIVE=true npx tsx scripts/post-handoff.ts

# With overrides
PRICE=5 VENUE="Agentic AI SF Hackathon" LIVE=true npx tsx scripts/post-handoff.ts
```

- Default mode is **dry run** — it prints the title, price, evidence, and full
  description, calls `createBounty({ dryRun: true })`, and posts nothing.
- `LIVE=true` actually publishes the open listing. **It still costs $0** until
  you accept an applicant.
- `PRICE=` overrides the bounty price; `VENUE=` overrides the venue string woven
  into the listing (defaults to `Agentic AI SF Hackathon`).

Requires `RENTAHUMAN_API_KEY=rah_...` in the environment (loaded via
`scripts/_env`).

---

## Running it in the demo (live/scale option)

1. **Preview** the listing: `npx tsx scripts/post-handoff.ts`. Confirm the copy
   and price read right.
2. **Publish** it: `... LIVE=true npx tsx scripts/post-handoff.ts`. This is free.
3. When someone on-site applies, **accept** them (the $5 is escrowed at this
   point) and hand them the envelope.
4. Brief them exactly like the planted actor: when the **WEARING** panel on the
   dashboard lights up with the player's live description, read it, walk to that
   person, hand over the envelope, say nothing.
5. **If the bounty doesn't fill or the courier is a no-show, use the planted
   teammate.** That path is always ready and the demo doesn't change.

See [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md) (pre-flight step 7 and Beat 4) for where
this lands in the on-stage script.

---

## Where it sits in the architecture

RentAHuman is **outside the message-to-reply loop**. Recruitment happens once,
at the finale, driven from a script — not from `handleInbound`. It never touches
the critical path of the live mission, so it can't stall the demo. See
[`ARCHITECTURE.md`](ARCHITECTURE.md) §5.
