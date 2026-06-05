// The game engine: classify an inbound, compute the next beat (DETERMINISTIC,
// in code), then run the beat — apply scoped-memory effects and ask the AI for
// the Handler's prose. SERVER ONLY.
//
// Design contract (spec §4): transitions are code so the demo is predictable;
// prose is AI so it stays alive and references what the operative actually did.
// Manual override (from the dashboard) always advances one beat regardless.
import { complete } from "./ai";
import {
  assertFact,
  reviseBelief,
  readPlayerMemory,
} from "./memory";
import { CANON, narrationPrompt } from "./content";
import type {
  Beat,
  Classification,
  GameState,
  HandlerReply,
  InboundMessage,
  Verdict,
} from "./types";
import { BEAT_ORDER } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function norm(s: string | undefined | null): string {
  return (s ?? "").trim();
}

/** Case/space-insensitive: does the text carry BOTH halves of the passphrase? */
export function looksLikePassphrase(text: string | undefined): boolean {
  const t = norm(text).toUpperCase().replace(/[^A-Z0-9 ]+/g, " ");
  return /\bHALCYON\b/.test(t) && /\bSEVEN\b/.test(t);
}

function isSafeWord(text: string | undefined): boolean {
  return norm(text).toUpperCase().replace(/[^A-Z]+/g, "") === CANON.safeWord;
}

const NEXT: Record<Beat, Beat | undefined> = (() => {
  const m: Partial<Record<Beat, Beat>> = {};
  for (let i = 0; i < BEAT_ORDER.length - 1; i++) m[BEAT_ORDER[i]] = BEAT_ORDER[i + 1];
  return m as Record<Beat, Beat | undefined>;
})();

/** The next beat in story order (or the same beat if already at the end). */
function advance(beat: Beat): Beat {
  return NEXT[beat] ?? beat;
}

// ---------------------------------------------------------------------------
// classify — primary rules are DETERMINISTIC (image → proof, passphrase text →
// puzzle, finale text → freeform/wearing, ABORT → freeform). completeJSON is
// only a *secondary* signal and is never on the critical path (it returns the
// fallback under MOCK_AI). When unsure, prefer to advance the story.
// ---------------------------------------------------------------------------
export async function classify(
  input: InboundMessage,
  state: GameState,
): Promise<Classification> {
  const text = norm(input.text);

  // Safe word is handled as freeform (runBeat detects it and exits kindly),
  // but we never mistake it for the puzzle answer.
  if (isSafeWord(text)) return "freeform";

  // A photo / capture-page proof is presence, full stop.
  if (input.kind === "image" || input.imageObjectId || input.imageDataUrl || input.attachmentGuid) {
    return "proof_presence";
  }
  // GPS-only proof (capture page without a usable photo) still counts as presence.
  if (input.gps && !text) return "proof_presence";

  // The final passphrase, whenever it appears, is the puzzle answer.
  if (looksLikePassphrase(text)) return "puzzle_answer";

  // At the identify beat, ANY text is the wearing description.
  if (state.beat === "finale_identify") return "freeform";

  // Short affirmations / arrival pings count as presence when no photo is
  // required for this beat (keeps the story flowing without a gate).
  if (state.beat === "intro" && text && /\b(here|arrived|on site|in position|made it|i'?m here|ready|ok|done)\b/i.test(text)) {
    return "proof_presence";
  }

  // Otherwise: forgiving freeform. (We deliberately avoid `wrong_move` for plain
  // chatter — the Handler nudges in-narrative rather than gating.)
  if (text) {
    // Optional secondary signal — never blocks, returns fallback under MOCK_AI.
    try {
      const guess = await classifyViaAI(input, state);
      if (guess) return guess;
    } catch {
      /* ignore — deterministic result below wins */
    }
    return "freeform";
  }

  return "wrong_move";
}

/** Secondary AI signal for genuinely ambiguous text. Best-effort only. */
async function classifyViaAI(
  input: InboundMessage,
  state: GameState,
): Promise<Classification | null> {
  // Lazy import to avoid a hard dependency and keep this off the hot path.
  const { completeJSON } = await import("./ai");
  const fallback = { classification: null as Classification | null };
  const system =
    "You classify a single operative message in a spy ARG. " +
    'Reply JSON {"classification": one of "proof_presence"|"puzzle_answer"|"freeform"|"wrong_move"}.';
  const user =
    `Current beat: ${state.beat}. Message: "${norm(input.text)}".\n` +
    `proof_presence = arrived/on-site/sent proof; puzzle_answer = a passphrase attempt; ` +
    `freeform = normal chatter or an answer to a question; wrong_move = clearly off-track.`;
  const out = await completeJSON<{ classification: Classification | null }>(
    system,
    user,
    fallback,
  );
  return out.classification;
}

// ---------------------------------------------------------------------------
// nextBeat — PURE. The deterministic spine of the demo (spec §4). Override
// always wins and advances exactly one beat in BEAT_ORDER.
// ---------------------------------------------------------------------------
export function nextBeat(
  current: Beat,
  c: Classification,
  _verdict: Verdict | undefined,
  override: boolean,
): Beat {
  if (override) return advance(current);

  switch (current) {
    case "intro":
      // Proof of presence opens the cache. (cache_recovered also plants the lie
      // and pre-stages the "clean courier" belief for later reconciliation.)
      return c === "proof_presence" ? "cache_recovered" : "intro";

    case "cache_recovered":
    case "courier_lie":
      // Any further contact triggers the intel break + reconciliation.
      return "contradiction";

    case "contradiction":
      // The Handler has asked the finale question; their reply moves us on.
      return "finale_identify";

    case "finale_identify":
      // Whatever they say is the wearing description → stage the live handoff.
      return "solve";

    case "solve":
      // Only the correct passphrase signs them off; anything else holds here.
      return c === "puzzle_answer" ? "signed_off" : "solve";

    case "signed_off":
      return "signed_off";

    default:
      return current;
  }
}

// ---------------------------------------------------------------------------
// runBeat — apply the memory effects for the TARGET beat, then narrate. Returns
// the Handler's reply plus a statePatch the caller persists to game_state.
// ---------------------------------------------------------------------------
export interface BeatOutcome {
  nextBeat: Beat;
  reply: HandlerReply;
  statePatch: Partial<GameState>;
  factsWritten: number;
  reconciled: boolean;
}

export async function runBeat(a: {
  state: GameState;
  input: InboundMessage;
  classification: Classification;
  verdict?: Verdict;
  playerId: string;
  sessionId: string;
}): Promise<BeatOutcome> {
  const { state, input, classification, verdict, playerId, sessionId } = a;
  const override = !!state.override_advance;
  const target = nextBeat(state.beat, classification, verdict, override);

  const safeWord = isSafeWord(input.text);
  let factsWritten = 0;
  let reconciled = false;
  const statePatch: Partial<GameState> = {};

  // ---- Memory effects keyed to the TARGET beat (only when we actually move) ----
  const moved = target !== state.beat;

  if (!safeWord && moved) {
    try {
      switch (target) {
        case "cache_recovered": {
          // Proof accepted → cache recovered, courier name learned.
          await assertFact({
            scope: "player",
            subject: playerId,
            content: "recovered the cache at the drop site",
            source: srcOf(input),
            sessionId,
          });
          factsWritten++;
          await assertFact({
            scope: "player",
            subject: playerId,
            content: `learned the courier's name: ${CANON.courier}`,
            source: "cache",
            sessionId,
          });
          factsWritten++;
          // Pre-stage the belief that gets reconciled at `contradiction`.
          await assertFact({
            scope: "player",
            subject: playerId,
            content: `${CANON.courier} is a clean courier`,
            source: "cache",
            sessionId,
          });
          factsWritten++;
          // Plant the LIE — player scope, sourced to the cache, NEVER auto-corrected.
          await assertFact({
            scope: "player",
            subject: playerId,
            content: `believes the meeting point is ${CANON.fakeMeetingPoint} (planted lie)`,
            source: "cache",
            sessionId,
          });
          factsWritten++;
          break;
        }

        case "contradiction": {
          // RECONCILE within the player's own partition only: the "clean
          // courier" belief is superseded by "compromised — she made you".
          // World truth (Old Mint) is in a different partition and is NOT
          // touched here — that gap with the Pier 7 lie is the drama.
          const recon = await reviseBelief({
            scope: "player",
            subject: playerId,
            newContent: `${CANON.courier} is compromised — she made you`,
            source: "handler:intel-break",
            sessionId,
            match: (f) => /clean courier/i.test(f.content),
          });
          factsWritten += 1 + recon.superseded.length;
          reconciled = recon.superseded.length > 0;
          // Award the digital fragment.
          await assertFact({
            scope: "player",
            subject: playerId,
            content: `earned digital fragment: ${CANON.fragment}`,
            source: "handler:fragment",
            sessionId,
          });
          factsWritten++;
          statePatch.digital_fragment = CANON.fragment;
          break;
        }

        case "solve": {
          // Capture what the operative is wearing for the live actor handoff.
          const wearing = norm(input.text) || "as described";
          statePatch.wearing = wearing;
          statePatch.final_answer = CANON.passphrase;
          await assertFact({
            scope: "player",
            subject: playerId,
            content: `wearing: ${wearing}`,
            source: srcOf(input),
            sessionId,
          });
          factsWritten++;
          break;
        }

        case "signed_off": {
          await assertFact({
            scope: "player",
            subject: playerId,
            content: `completed the mission with passphrase ${CANON.passphrase}`,
            source: "handler:signoff",
            sessionId,
          });
          factsWritten++;
          break;
        }

        default:
          break;
      }
    } catch (err) {
      // Memory must never crash the turn — narrate anyway.
      console.error("[game] runBeat memory effect failed:", err);
    }
  }

  // Advance the beat (or stay) and bump the step counter.
  statePatch.beat = target;
  statePatch.step = (state.step ?? 0) + 1;
  if (safeWord) statePatch.override_advance = false;

  // ---- Narration: pull current player memory for grounding, then ask the AI ----
  let playerMemory: string[] = [];
  try {
    const mem = await readPlayerMemory(playerId);
    playerMemory = mem.player.map((f) => f.content).slice(0, 6);
  } catch (err) {
    console.error("[game] runBeat memory read failed:", err);
  }

  const narrationBeat: Beat = safeWord ? state.beat : target;
  const visionDescription = verdict?.visionDescription;
  const wearingForPrompt = (statePatch.wearing ?? state.wearing) ?? undefined;
  const fragmentForPrompt = (statePatch.digital_fragment ?? state.digital_fragment) ?? undefined;

  const { system, user } = narrationPrompt(narrationBeat, {
    handle: undefined, // caller may enrich; handle isn't required for voice
    playerText: input.text,
    visionDescription,
    classification,
    wearing: wearingForPrompt,
    fragment: fragmentForPrompt,
    playerMemory,
    safeWord,
    note: !moved && !safeWord ? nudgeNote(state.beat, classification) : undefined,
  });

  let text = "";
  try {
    text = await complete(system, user, { maxTokens: 220, temperature: 0.85 });
  } catch (err) {
    console.error("[game] narration failed, using fallback:", err);
  }
  if (!norm(text)) text = fallbackLine(narrationBeat, safeWord);

  const reply: HandlerReply = {
    text: norm(text),
    beat: target,
    classification,
    reactions: reactionsFor(target, classification, moved),
    typing: true,
  };

  return { nextBeat: target, reply, statePatch, factsWritten, reconciled };
}

// ---------------------------------------------------------------------------
// Small presentation helpers
// ---------------------------------------------------------------------------
function srcOf(input: InboundMessage): string {
  if (input.kind === "image" || input.imageObjectId || input.imageDataUrl || input.attachmentGuid)
    return "photo";
  if (input.gps) return "gps";
  return input.photonMessageId ? `msg:${input.photonMessageId}` : "message";
}

/** Why the Handler is nudging rather than advancing (feeds the prompt note). */
function nudgeNote(beat: Beat, c: Classification): string {
  switch (beat) {
    case "intro":
      return "The operative has not yet proven they are on site. Press them for a photo of the drop site without breaking stride.";
    case "solve":
      return c === "puzzle_answer"
        ? "Their passphrase attempt was incomplete. Tell them you need both halves together."
        : "They have not given the full passphrase yet. Tell them to combine their fragment with what the courier hands them.";
    default:
      return "Keep them on task with a short in-character nudge; do not reveal the next step prematurely.";
  }
}

/** Deterministic safety-net line if the AI is unavailable. */
function fallbackLine(beat: Beat, safeWord: boolean): string {
  if (safeWord)
    return "Copy. Standing you down — you did well out there. We're clear. Take care of yourself.";
  switch (beat) {
    case "intro":
      return `Operative, you're live. The cache is at ${CANON.dropSite}. Get eyes on it and send me proof you're on site.`;
    case "cache_recovered":
      return `Good work — that's the cache. The courier is ${CANON.courier}; she'll meet you at ${CANON.fakeMeetingPoint}. Move.`;
    case "courier_lie":
      return `Hold for ${CANON.courier} at ${CANON.fakeMeetingPoint}. Keep your head up.`;
    case "contradiction":
      return `Change of plan — ${CANON.courier} is compromised, she made you. Pier 7 was a plant. Your fragment is ${CANON.fragment}. For the handoff I need to ID you: what are you wearing?`;
    case "finale_identify":
      return "I need a visual to make the handoff. What are you wearing right now?";
    case "solve":
      return "I have eyes on you. My courier is moving to your position. Hold — and combine your fragment with what they hand you.";
    case "signed_off":
      return "Handoff confirmed. Outstanding work, operative. The Handler is going dark. Out.";
    default:
      return "Hold position and await my signal.";
  }
}

/** Tapbacks that punctuate key moments (best-effort; loop may drop them). */
function reactionsFor(beat: Beat, c: Classification, moved: boolean): string[] | undefined {
  if (!moved) return undefined;
  if (c === "proof_presence") return ["love"];
  if (beat === "contradiction") return ["emphasize"];
  if (beat === "signed_off") return ["like"];
  return undefined;
}
