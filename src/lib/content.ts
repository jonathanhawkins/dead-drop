// DEAD DROP — canonical story content + the Handler's voice. SERVER ONLY.
//
// This file is the single source of narrative truth: the canon every other
// module references, the world/handler-secret facts we seed into scoped memory,
// the Handler persona, and the prompt builder that turns a deterministic beat +
// runtime context into a system/user pair for the AI gateway.
//
// Beat transitions live in game.ts (code, deterministic). Prose lives here +
// the AI (alive, but on-rails). Keep canon strings EXACT — memory.ts, game.ts
// and the dashboard all key off the same words.
import type { Beat, Scope } from "./types";

// ---------------------------------------------------------------------------
// CANON — the immutable facts of the mission. Use these verbatim everywhere.
// ---------------------------------------------------------------------------
export const CANON = {
  /** The operative who went dark and left the cache. */
  operative: "SABLE",
  /** Where the drop is hidden in the room (the sponsor banner on its stand). */
  dropSite: "the sponsor banner",
  /** The courier whose name the cache reveals. */
  courier: "Mara Voss",
  /**
   * The PLANTED LIE. Lives in player scope, sourced to the cache, and is NEVER
   * auto-corrected by world truth. The gap between this and `realMeetingPoint`
   * is the drama the dashboard puts on display.
   */
  fakeMeetingPoint: "the fountain at Pier 7",
  /** The WORLD TRUTH. Lives in world scope; never reaches over to fix the lie. */
  realMeetingPoint: "the loading dock behind the Old Mint",
  /** Earned in-game (digital half of the passphrase). */
  fragment: "HALCYON",
  /** Handed over physically by the real-world actor (the envelope). */
  envelopeHalf: "SEVEN",
  /** fragment + envelope — the final passphrase that signs the player off. */
  passphrase: "HALCYON SEVEN",
  /** The kind exit. Typing this at any time ends the game gently. */
  safeWord: "ABORT",
} as const;

export type Canon = typeof CANON;

// ---------------------------------------------------------------------------
// HANDLER_PERSONA — the system voice. Terse, controlled, cinematic. Theatrical,
// never threatening. 1–3 sentences. Never breaks character. Always reacts to
// what the player JUST did.
// ---------------------------------------------------------------------------
export const HANDLER_PERSONA = [
  "You are THE HANDLER: a terse, controlled, cinematic spymaster running a live field operative over text.",
  "Voice: clipped, precise, a little noir. You speak in 1 to 3 short sentences. No filler, no emoji, no markdown, no lists.",
  "You are calm and in command. Theatrical, never threatening — this is a game and the operative is a civilian you are guiding with style.",
  "You ALWAYS reference what the operative just did or sent — make them feel seen. You never explain the mechanics or mention that this is a game.",
  `You never break character. The codeword "${CANON.safeWord}" is a safe word: if the operative sends it, you drop the mission warmly, thank them, and wish them well.`,
  "Never reveal the handler-secret intel directly; let it shape your tone and your reveals, but keep the operative one beat behind the truth.",
  "Address the operative as 'operative' or by their handle if given. End most messages with a clear next instruction.",
].join(" ");

// ---------------------------------------------------------------------------
// WORLD_FACTS — seeded once per world (and the Handler's private intel).
// `world` scope = objective truth visible to all. `handler-secret` = the
// Handler's private knowledge that NEVER auto-corrects a player belief.
// These are the facts that make the reconciliation drama legible on the
// dashboard's three columns.
// ---------------------------------------------------------------------------
export const WORLD_FACTS: {
  scope: Scope;
  subject: string;
  content: string;
  source: string;
}[] = [
  // ---- world scope (subject is the literal "world") ----
  {
    scope: "world",
    subject: "world",
    content: `Operative ${CANON.operative} went dark and left a cache hidden at ${CANON.dropSite}.`,
    source: "seed:world",
  },
  {
    scope: "world",
    subject: "world",
    content: `The cache identifies the courier as ${CANON.courier}.`,
    source: "seed:world",
  },
  {
    scope: "world",
    subject: "world",
    content: `The real handoff point is ${CANON.realMeetingPoint}.`,
    source: "seed:world",
  },
  {
    scope: "world",
    subject: "world",
    content: `The digital fragment of the passphrase is ${CANON.fragment}.`,
    source: "seed:world",
  },
  {
    scope: "world",
    subject: "world",
    content: `The physical half of the passphrase is ${CANON.envelopeHalf}; combined the passphrase is ${CANON.passphrase}.`,
    source: "seed:world",
  },
  // ---- handler-secret scope (the Handler's private intel) ----
  {
    scope: "handler-secret",
    subject: "world",
    content: `${CANON.courier} is compromised — she made the operative. The Pier 7 location fed to the operative is a deliberate plant to flush the tail.`,
    source: "seed:handler",
  },
  {
    scope: "handler-secret",
    subject: "world",
    content: `Do NOT correct the operative's belief about ${CANON.fakeMeetingPoint} until the contradiction beat; the lie is operational cover.`,
    source: "seed:handler",
  },
  {
    scope: "handler-secret",
    subject: "world",
    content: `Final handoff is a live person; identify the operative by what they are wearing, then send the courier in with the envelope (${CANON.envelopeHalf}).`,
    source: "seed:handler",
  },
];

// ---------------------------------------------------------------------------
// narrationPrompt(beat, ctx) — build the {system,user} pair for ai.complete().
// The beat fixes the BEAT GOAL (what the Handler must accomplish this turn);
// ctx carries what the player just did so the prose can reference it.
// ---------------------------------------------------------------------------
export interface NarrationContext {
  /** The player's handle, if we know it. */
  handle?: string | null;
  /** Verbatim text the operative just sent (if any). */
  playerText?: string;
  /** Vision model's description of a photo the operative just sent (if any). */
  visionDescription?: string;
  /** How we classified this inbound (proof_presence | puzzle_answer | ...). */
  classification?: string;
  /** What the operative is wearing (known once captured at finale_identify). */
  wearing?: string | null;
  /** The earned digital fragment, once awarded. */
  fragment?: string | null;
  /** Compact recall of the operative's current player-scope beliefs. */
  playerMemory?: string[];
  /** True when the operative sent the safe word — exit warmly. */
  safeWord?: boolean;
  /** Optional extra note for the Handler this turn (e.g. a nudge reason). */
  note?: string;
}

/** Per-beat goal the Handler must hit this turn (the only thing that varies). */
const BEAT_GOALS: Record<Beat, string> = {
  intro:
    `The operative has made contact. Acknowledge them, set the scene in one breath, and direct them to find the cache hidden at ${CANON.dropSite}. ` +
    "Ask them to send proof they are on site (a photo of the drop site).",
  cache_recovered:
    `The operative just proved they are on site and recovered the cache. React to what you can see in their proof, then reveal the courier's name: ${CANON.courier}. ` +
    `Tell them the courier will meet them — name the meeting point as ${CANON.fakeMeetingPoint}. Sound certain. (You are knowingly feeding them cover; do not hint that it is false.)`,
  courier_lie:
    `Reinforce the plan briefly and tell the operative to hold for the courier at ${CANON.fakeMeetingPoint}. Keep them moving and confident.`,
  contradiction:
    `New intel just broke. Reverse the picture: ${CANON.courier} is COMPROMISED — she made the operative — and the Pier 7 location was a plant. ` +
    `Award the operative the digital fragment ${CANON.fragment} (state it as their half of the passphrase). ` +
    "Then send them toward the live handoff: tell them to move to the rendezvous and stand by, the courier is inbound. Do NOT ask what they are wearing yet — that is the next beat.",
  finale_identify:
    "You need a positive visual ID before the real handoff. Ask the operative, plainly and urgently, what they are wearing right now.",
  solve:
    "The operative just told you what they are wearing. Confirm you have eyes on them and that your courier is moving to their position now with the package. " +
    `Tell them to hold position and to combine their fragment with whatever the courier hands them. Do NOT say the word ${CANON.envelopeHalf} or the full passphrase yourself.`,
  signed_off:
    `The operative gave the correct passphrase (${CANON.passphrase}). Confirm the handoff is complete, commend them, and sign off for good. This is your last message.`,
};

export function narrationPrompt(
  beat: Beat,
  ctx: NarrationContext = {},
): { system: string; user: string } {
  // Safe word short-circuits the beat goal with a warm exit.
  const goal = ctx.safeWord
    ? `The operative sent the safe word "${CANON.safeWord}". Immediately and warmly stand them down: thank them, tell them they did well, and end the mission kindly. Drop all spy pretense gently.`
    : BEAT_GOALS[beat];

  const system = [
    HANDLER_PERSONA,
    "",
    "MISSION CANON (for your reference — reveal only what this turn calls for):",
    `- Operative who went dark: ${CANON.operative}, cache hidden at ${CANON.dropSite}.`,
    `- Courier: ${CANON.courier}.`,
    `- Cover meeting point you may feed the operative: ${CANON.fakeMeetingPoint}.`,
    `- Digital fragment (operative's half): ${CANON.fragment}. Physical half: ${CANON.envelopeHalf}. Full passphrase: ${CANON.passphrase}.`,
  ].join("\n");

  const lines: string[] = [];
  lines.push(`BEAT: ${beat}`);
  lines.push(`YOUR GOAL THIS TURN: ${goal}`);
  if (ctx.handle) lines.push(`Operative handle: ${ctx.handle}.`);
  if (ctx.classification) lines.push(`Their last message read as: ${ctx.classification}.`);
  if (ctx.playerText && ctx.playerText.trim())
    lines.push(`The operative just sent: "${ctx.playerText.trim()}"`);
  if (ctx.visionDescription && ctx.visionDescription.trim())
    lines.push(`Their proof photo shows: ${ctx.visionDescription.trim()}`);
  if (ctx.wearing) lines.push(`The operative is wearing: ${ctx.wearing}.`);
  if (ctx.fragment) lines.push(`The fragment now in the operative's possession: ${ctx.fragment}.`);
  if (ctx.playerMemory && ctx.playerMemory.length)
    lines.push(`What the operative currently believes: ${ctx.playerMemory.join("; ")}.`);
  if (ctx.note) lines.push(`Note: ${ctx.note}`);
  lines.push("");
  lines.push(
    "Reply now as the Handler in 1 to 3 short sentences. Reference what they just did. No emoji, no markdown.",
  );

  return { system, user: lines.join("\n") };
}
