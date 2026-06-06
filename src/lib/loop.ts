// The spine: turn a normalized InboundMessage into the Handler's reply. SERVER ONLY.
//
// This module orchestrates the four mandatory tools per turn:
//   - Photon  : pull attachment bytes for a proof photo (when not inlined).
//   - Butterbase: persist players/sessions/game_state/messages/events rows.
//   - XTrace  : scoped memory reads/writes (via memory.ts + game.runBeat).
//   - AI      : vision verdict + Handler narration (via ai.ts + game.runBeat).
//
// Hard contract (BUILD_SPEC §5 ROLE: engine):
//   handleInbound does NOT send — it computes and returns the reply; the caller
//   (the webhook route) sends via photon.sendText. Every external call is wrapped
//   so a single failure degrades gracefully and never bubbles a 500 to Photon.
import {
  dbInsert,
  dbSelectOne,
  dbUpdate,
} from "./butterbase";
import { describeImage, toJpegDataUrl } from "./ai";
import { fetchAttachmentBytes } from "./photon";
import { seedWorldFacts, readPlayerMemory } from "./memory";
import { classify, runBeat, looksLikePassphrase } from "./game";
import { CODENAME_ASK, sanitizeCodename } from "./content";
import { env } from "./env";
import type {
  GameState,
  HandlerReply,
  InboundMessage,
  Player,
  Session,
  TurnResult,
  Verdict,
} from "./types";

if (typeof window !== "undefined") {
  throw new Error("loop.ts is server-only (it orchestrates secret-bearing modules).");
}

// ---------------------------------------------------------------------------
// Codename capture — at the intro beat we ask the operative for a handle and
// store their reply on players.codename. Kill-switch: set CODENAME_CAPTURE=false
// to revert to the original flow instantly. Arrival pings / the safe word / a
// passphrase are never mistaken for a codename (they fall through to the machine).
// ---------------------------------------------------------------------------
const CODENAME_CAPTURE = process.env.CODENAME_CAPTURE !== "false";
const ARRIVAL_PING = /\b(here|arrived|on site|in position|made it|i'?m here|ready|ok|okay|done)\b/i;

function isReservedFirstWord(text: string): boolean {
  if (text.toUpperCase().replace(/[^A-Z]+/g, "") === "ABORT") return true; // safe word
  if (looksLikePassphrase(text)) return true; // a passphrase attempt, not a name
  if (ARRIVAL_PING.test(text)) return true; // arrival ping → presence flow, not a name
  return false;
}

function codenameAskReply(): HandlerReply {
  return { text: CODENAME_ASK, beat: "intro", classification: "freeform", typing: true };
}

function heldIntroTurn(player: Player, session: Session, reply: HandlerReply): TurnResult {
  return {
    player,
    session,
    stateBefore: "intro",
    stateAfter: "intro",
    classification: "freeform",
    reply,
    factsWritten: 0,
    reconciled: false,
  };
}

// ---------------------------------------------------------------------------
// Player / session / state ensure helpers
// ---------------------------------------------------------------------------

/** Upsert a player by their (unique) phone number. */
async function upsertPlayer(phone: string, handle?: string): Promise<Player> {
  const existing = await dbSelectOne<Player>("players", {
    filters: { phone: `eq.${phone}` },
  });
  if (existing) {
    // Backfill a handle if we just learned one and didn't have it before.
    if (handle && !existing.handle) {
      try {
        return await dbUpdate<Player>("players", existing.id, { handle });
      } catch (err) {
        console.error("[loop] upsertPlayer handle backfill failed (using existing):", err);
        return existing;
      }
    }
    return existing;
  }
  return dbInsert<Player>("players", {
    phone,
    handle: handle ?? null,
  });
}

/** The newest active session for a player, if one exists. */
async function findActiveSession(playerId: string): Promise<Session | null> {
  return dbSelectOne<Session>("sessions", {
    filters: { player_id: `eq.${playerId}`, status: "eq.active" },
    order: "created_at.desc",
  });
}

/** Create a fresh session row. */
async function createSession(
  playerId: string,
  channel: InboundMessage["channel"],
): Promise<Session> {
  return dbInsert<Session>("sessions", {
    player_id: playerId,
    status: "active",
    channel,
    handler_line: env.photon.handlerLine,
    started_at: new Date().toISOString(),
  });
}

/** The game_state row for a session (unique per session). */
async function findState(sessionId: string): Promise<GameState | null> {
  return dbSelectOne<GameState>("game_state", {
    filters: { session_id: `eq.${sessionId}` },
  });
}

/** Create the opening game_state at beat "intro". */
async function createState(sessionId: string, playerId: string): Promise<GameState> {
  return dbInsert<GameState>("game_state", {
    session_id: sessionId,
    player_id: playerId,
    beat: "intro",
    step: 0,
    digital_fragment: null,
    final_answer: null,
    wearing: null,
    override_advance: false,
    codename_asked: false,
  });
}

// ---------------------------------------------------------------------------
// startSession — the explicit entrypoint (dashboard "Start Session" + opening call).
// ---------------------------------------------------------------------------
/**
 * Begin a mission for `phone`: upsert the player, open a session + game_state at
 * beat "intro", and seed the world/handler-secret facts (idempotent-ish). The
 * opening voice call is fired by the /api/session/start route, not here, so this
 * stays pure data setup and is safe to call from anywhere (including auto-start).
 */
export async function startSession(
  phone: string,
  handle?: string,
): Promise<{ player: Player; session: Session; state: GameState }> {
  const player = await upsertPlayer(phone, handle);

  // Reuse an in-flight session if the player already has one; otherwise open one.
  let session = await findActiveSession(player.id);
  if (!session) {
    session = await createSession(player.id, env.photon.channel);
  }

  let state = await findState(session.id);
  if (!state) {
    state = await createState(session.id, player.id);
  }

  // Seed the room's truth once (deduped inside memory.seedWorldFacts). Never let
  // a seeding failure block the session from starting.
  try {
    await seedWorldFacts(session.id);
  } catch (err) {
    console.error("[loop] seedWorldFacts failed (continuing):", err);
  }

  return { player, session, state };
}

// ---------------------------------------------------------------------------
// Dedupe — Photon can retry a webhook; we key on photonMessageId in `messages`.
// ---------------------------------------------------------------------------
async function isDuplicate(photonMessageId?: string): Promise<boolean> {
  if (!photonMessageId) return false;
  try {
    const prior = await dbSelectOne("messages", {
      filters: { photon_message_id: `eq.${photonMessageId}` },
      select: "id",
    });
    return !!prior;
  } catch (err) {
    // If the dedupe lookup fails, prefer to process (better a rare double-send
    // than a dropped message). Logged, never thrown.
    console.error("[loop] dedupe lookup failed (processing anyway):", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Message logging (best-effort; a logging failure never blocks a turn).
// ---------------------------------------------------------------------------
async function logInbound(
  input: InboundMessage,
  sessionId: string,
  playerId: string,
): Promise<void> {
  try {
    await dbInsert("messages", {
      session_id: sessionId,
      player_id: playerId,
      direction: "inbound",
      channel: input.channel,
      content_type: input.kind,
      body: input.text ?? null,
      photon_message_id: input.photonMessageId ?? null,
      attachment_guid: input.attachmentGuid ?? null,
      attachment_object_id: input.imageObjectId ?? null,
      meta: {
        source: input.source,
        gps: input.gps ?? null,
        hasImageDataUrl: !!input.imageDataUrl,
        receivedAt: input.receivedAt,
      },
    });
  } catch (err) {
    console.error("[loop] logInbound failed (continuing):", err);
  }
}

async function logOutbound(
  reply: HandlerReply,
  input: InboundMessage,
  sessionId: string,
  playerId: string,
  verdict?: Verdict,
): Promise<void> {
  try {
    await dbInsert("messages", {
      session_id: sessionId,
      player_id: playerId,
      direction: "outbound",
      channel: input.channel,
      content_type: "text",
      body: reply.text,
      photon_message_id: null,
      meta: {
        source: "handler",
        beat: reply.beat,
        classification: reply.classification,
        reactions: reply.reactions ?? null,
        typing: reply.typing ?? null,
        verdict: verdict ?? null,
      },
    });
  } catch (err) {
    console.error("[loop] logOutbound failed (continuing):", err);
  }
}

/** Log a proof event (photo/gps presence) to the `events` table. Best-effort. */
async function logProofEvent(
  input: InboundMessage,
  sessionId: string,
  playerId: string,
  verdict: Verdict,
): Promise<void> {
  try {
    await dbInsert("events", {
      session_id: sessionId,
      player_id: playerId,
      kind: input.kind === "image" ? "proof_photo" : "proof_gps",
      payload: {
        source: input.source,
        gps: input.gps ?? null,
        note: verdict.note,
        visionDescription: verdict.visionDescription ?? null,
      },
      photo_object_id: input.imageObjectId ?? null,
      verdict: verdict.ok ? "ok" : "weak",
    });
  } catch (err) {
    console.error("[loop] logProofEvent failed (continuing):", err);
  }
}

// ---------------------------------------------------------------------------
// Verdict builders — vision / gps. A Verdict is a *note*, never a hard gate;
// classification + nextBeat decide the story. The verdict carries the vision
// description that grounds the Handler's prose.
// ---------------------------------------------------------------------------
async function buildImageVerdict(input: InboundMessage): Promise<Verdict> {
  // 1) Prefer an inline data URL (simulator / capture-direct path).
  if (input.imageDataUrl) {
    try {
      const desc = await describeImage(
        "You are verifying an operative's proof-of-presence photo of a drop site (a sponsor banner on a stand in an event room). Describe what you see in 1-2 sentences, noting any banner, logo, or signage.",
        { dataUrl: input.imageDataUrl },
      );
      return {
        ok: true,
        confidence: 0.7,
        note: "inline image accepted as proof of presence",
        visionDescription: desc,
      };
    } catch (err) {
      console.error("[loop] describeImage(inline) failed:", err);
      return weakImageVerdict("inline image present but vision unavailable");
    }
  }

  // 2) Capture-page path: bytes live in Butterbase storage.
  if (input.imageObjectId) {
    try {
      const { storageDownloadBytes } = await import("./butterbase");
      const { bytes, contentType } = await storageDownloadBytes(input.imageObjectId);
      const dataUrl = await toJpegDataUrl(bytes, contentType);
      const desc = await describeImage(
        "You are verifying an operative's proof-of-presence photo of a drop site (a sponsor banner on a stand). Describe what you see in 1-2 sentences.",
        { dataUrl },
      );
      return {
        ok: true,
        confidence: 0.7,
        note: "stored image accepted as proof of presence",
        visionDescription: desc,
      };
    } catch (err) {
      console.error("[loop] storage image verdict failed:", err);
      return weakImageVerdict("stored image present but could not be read");
    }
  }

  // 3) iMessage path: pull bytes by GUID via the Photon SDK, then describe.
  if (input.attachmentGuid) {
    try {
      const { bytes, mime } = await fetchAttachmentBytes(
        input.attachmentGuid,
        input.handlerLine,
      );
      const dataUrl = await toJpegDataUrl(bytes, mime);
      const desc = await describeImage(
        "You are verifying an operative's proof-of-presence photo of a drop site (a sponsor banner on a stand). Describe what you see in 1-2 sentences.",
        { dataUrl },
      );
      return {
        ok: true,
        confidence: 0.7,
        note: "iMessage attachment accepted as proof of presence",
        visionDescription: desc,
      };
    } catch (err) {
      // Under MOCK_PHOTON (or a fetch failure) we still treat the photo as
      // presence — the story should never stall on a missing byte stream.
      console.error("[loop] fetchAttachmentBytes/vision failed:", err);
      return weakImageVerdict("photo received; bytes unavailable, accepting presence");
    }
  }

  // kind === "image" but no locator at all — still treat as presence.
  return weakImageVerdict("image flagged with no retrievable bytes; accepting presence");
}

function weakImageVerdict(note: string): Verdict {
  return { ok: true, confidence: 0.4, note };
}

function buildGpsVerdict(input: InboundMessage): Verdict {
  const g = input.gps;
  if (!g) return { ok: false, confidence: 0, note: "no gps" };
  const acc = g.accuracy ?? undefined;
  return {
    ok: true,
    confidence: acc != null && acc <= 100 ? 0.6 : 0.5,
    note: `gps presence lat=${g.lat.toFixed(5)} lng=${g.lng.toFixed(5)}${
      acc != null ? ` (~${Math.round(acc)}m)` : ""
    }`,
  };
}

// ---------------------------------------------------------------------------
// handleInbound — one full turn. Returns the reply (DOES NOT send).
// ---------------------------------------------------------------------------
/**
 * Process a normalized inbound and return the Handler's reply + a TurnResult.
 *
 * Steps (BUILD_SPEC §5):
 *  1) dedupe on photonMessageId; 2) ensure player+session+state (auto-start);
 *  3) log inbound; 4) image → bytes → vision Verdict, or gps → Verdict;
 *  5) classify; 6) read player memory; 7) runBeat; 8) persist statePatch;
 *  9) log outbound; 10) return the reply for the caller to deliver.
 *
 * Never throws on the normal path. On a hard failure it returns a safe fallback
 * reply so the webhook can still 200 and the operative still hears from us.
 */
export async function handleInbound(
  input: InboundMessage,
): Promise<{ reply: HandlerReply; turn: TurnResult }> {
  // 1) Dedupe — a Photon retry of an already-processed message is a no-op ack.
  if (await isDuplicate(input.photonMessageId)) {
    console.log(`[loop] duplicate photonMessageId=${input.photonMessageId} — skipping send.`);
    return duplicateResult();
  }

  // 2) Ensure player + active session + game_state (auto-start if first contact).
  let player: Player;
  let session: Session;
  let state: GameState;
  try {
    const started = await startSession(input.fromPhone);
    player = started.player;
    session = started.session;
    state = started.state;
  } catch (err) {
    console.error("[loop] session ensure failed — returning fallback reply:", err);
    return errorFallbackResult();
  }

  const stateBefore = state.beat;

  // 3) Log the inbound message (best-effort).
  await logInbound(input, session.id, player.id);

  // 3.5) Codename capture (kill-switchable). At intro, before any proof: the
  //      first plain-text contact gets a "pick a handle" prompt; the next plain
  //      reply is stored as their codename. Photos / arrival pings / the safe
  //      word skip this entirely, so it never gates the mission.
  if (CODENAME_CAPTURE && state.beat === "intro" && !player.codename) {
    const text = (input.text ?? "").trim();
    const plainText =
      input.kind === "text" &&
      !!text &&
      !input.gps &&
      !input.imageDataUrl &&
      !input.imageObjectId &&
      !input.attachmentGuid;
    if (plainText && !isReservedFirstWord(text)) {
      if (!state.codename_asked) {
        try {
          state = await dbUpdate<GameState>("game_state", state.id, {
            codename_asked: true,
            updated_at: new Date().toISOString(),
          });
        } catch (err) {
          console.error("[loop] codename_asked persist failed (continuing):", err);
        }
        const reply = codenameAskReply();
        await logOutbound(reply, input, session.id, player.id);
        return { reply, turn: heldIntroTurn(player, session, reply) };
      }
      const codename = sanitizeCodename(text);
      if (codename) {
        try {
          player = await dbUpdate<Player>("players", player.id, { codename });
        } catch (err) {
          console.error("[loop] codename store failed (continuing):", err);
        }
      }
      // fall through → runBeat gives the personalized opener (handle = codename).
    }
  }

  // 4) Build a Verdict for proof inbounds (vision / gps). A note, not a gate.
  let verdict: Verdict | undefined;
  if (input.kind === "image" || input.imageDataUrl || input.imageObjectId || input.attachmentGuid) {
    verdict = await buildImageVerdict(input);
    await logProofEvent(input, session.id, player.id, verdict);
  } else if (input.gps) {
    verdict = buildGpsVerdict(input);
    await logProofEvent(input, session.id, player.id, verdict);
  }

  // 5) Classify (deterministic primary rules; AI is only a secondary signal).
  let classification;
  try {
    classification = await classify(input, state);
  } catch (err) {
    console.error("[loop] classify failed — defaulting to freeform:", err);
    classification = "freeform" as const;
  }

  // 6) Read the operative's current memory (world + their own beliefs). runBeat
  //    re-reads internally for narration; this read is for the TurnResult and is
  //    best-effort.
  try {
    await readPlayerMemory(player.id);
  } catch (err) {
    console.error("[loop] readPlayerMemory failed (continuing):", err);
  }

  // 7) Run the beat: memory effects + narration → reply + statePatch.
  let outcome;
  try {
    outcome = await runBeat({
      state,
      input,
      classification,
      verdict,
      playerId: player.id,
      sessionId: session.id,
      handle: player.codename ?? player.handle ?? undefined,
    });
  } catch (err) {
    console.error("[loop] runBeat failed — returning fallback reply:", err);
    return runtimeFallbackResult(player, session, stateBefore, classification, verdict);
  }

  // 8) Persist the statePatch to game_state (always stamp updated_at).
  try {
    state = await dbUpdate<GameState>("game_state", state.id, {
      ...outcome.statePatch,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[loop] game_state persist failed (reply still valid):", err);
    // Reflect the intended patch locally so the TurnResult is accurate even if
    // the write didn't land.
    state = { ...state, ...outcome.statePatch };
  }

  // 9) Log the outbound (best-effort).
  await logOutbound(outcome.reply, input, session.id, player.id, verdict);

  // 10) Return — the caller sends via photon.sendText.
  const turn: TurnResult = {
    player,
    session,
    stateBefore,
    stateAfter: outcome.nextBeat,
    classification,
    verdict,
    reply: outcome.reply,
    factsWritten: outcome.factsWritten,
    reconciled: outcome.reconciled,
  };
  return { reply: outcome.reply, turn };
}

// ---------------------------------------------------------------------------
// Fallback results — keep the webhook at 200 and the operative reassured even
// when the data layer or AI is unreachable. Synthesize a minimal TurnResult.
// ---------------------------------------------------------------------------
function placeholder(): { player: Player; session: Session; state: GameState } {
  const now = new Date().toISOString();
  const player: Player = { id: "", phone: "", handle: null, created_at: now };
  const session: Session = {
    id: "",
    player_id: "",
    status: "active",
    channel: env.photon.channel,
    handler_line: env.photon.handlerLine,
    started_at: now,
    created_at: now,
  };
  const state: GameState = {
    id: "",
    session_id: "",
    player_id: "",
    beat: "intro",
    step: 0,
    digital_fragment: null,
    final_answer: null,
    wearing: null,
    override_advance: false,
    updated_at: now,
    created_at: now,
  };
  return { player, session, state };
}

function duplicateResult(): { reply: HandlerReply; turn: TurnResult } {
  // A blank reply text signals the caller to send nothing (the dedupe case).
  const { player, session } = placeholder();
  const reply: HandlerReply = {
    text: "",
    beat: "intro",
    classification: "freeform",
  };
  return {
    reply,
    turn: {
      player,
      session,
      stateBefore: "intro",
      stateAfter: "intro",
      classification: "freeform",
      reply,
      factsWritten: 0,
      reconciled: false,
    },
  };
}

function errorFallbackResult(): { reply: HandlerReply; turn: TurnResult } {
  const { player, session } = placeholder();
  const reply: HandlerReply = {
    text: "Hold position, operative. The channel flickered — stay put and await my next signal.",
    beat: "intro",
    classification: "freeform",
    typing: true,
  };
  return {
    reply,
    turn: {
      player,
      session,
      stateBefore: "intro",
      stateAfter: "intro",
      classification: "freeform",
      reply,
      factsWritten: 0,
      reconciled: false,
    },
  };
}

function runtimeFallbackResult(
  player: Player,
  session: Session,
  stateBefore: TurnResult["stateBefore"],
  classification: TurnResult["classification"],
  verdict: Verdict | undefined,
): { reply: HandlerReply; turn: TurnResult } {
  const reply: HandlerReply = {
    text: "Copy that. Hold the line a moment — I'm reading you. Stand by for instructions.",
    beat: stateBefore,
    classification,
    typing: true,
  };
  return {
    reply,
    turn: {
      player,
      session,
      stateBefore,
      stateAfter: stateBefore,
      classification,
      verdict,
      reply,
      factsWritten: 0,
      reconciled: false,
    },
  };
}
