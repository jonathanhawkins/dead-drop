// Voice — the Handler's cinematic *opening call*. When a session starts the
// engine fires placeOpeningCall(); a phone rings and the Handler's recorded /
// synthesized monologue plays before the very first text lands. It sets the
// tone: an operative went dark, and the player has been activated to recover
// the cache.
//
// SERVER ONLY (reads provider credentials from the environment).
//
// Design contract (per BUILD_SPEC §5 ROLE: voice):
//   - VOICE_PROVIDER=mock (default): log the script + return { ok:true }.
//   - twilio | vapi | elevenlabs: a real-ish REST implementation, but ALWAYS
//     guarded by missing-credential checks that return { ok:false,
//     detail:"no creds" } before any network call is attempted.
//   - This module NEVER throws. The opening call is theatrical garnish; if it
//     fails for any reason the text mission must still proceed. Callers fire it
//     and ignore failures.
//
// NEEDS ENV (optional — only when VOICE_PROVIDER != "mock"; read directly here
// because @/lib/env intentionally only surfaces VOICE_PROVIDER):
//   VOICE_FROM_NUMBER            E.164 caller-ID the player sees (all providers)
//   TWILIO_ACCOUNT_SID           Twilio: account SID (ACxxxx)
//   TWILIO_AUTH_TOKEN            Twilio: auth token
//   VAPI_API_KEY                 Vapi:   private API key
//   VAPI_PHONE_NUMBER_ID         Vapi:   outbound phoneNumberId
//   VAPI_ASSISTANT_ID            Vapi:   (optional) prebuilt assistant id
//   ELEVENLABS_API_KEY           ElevenLabs: xi-api-key
//   ELEVENLABS_AGENT_ID          ElevenLabs: Conversational-AI agent id
//   ELEVENLABS_PHONE_NUMBER_ID   ElevenLabs: registered outbound phone_number_id

import { env } from "./env";

if (typeof window !== "undefined") {
  // Holds provider secrets — must never run in the browser.
  throw new Error("voice.ts is server-only.");
}

// ---------------------------------------------------------------------------
// The script — the Handler's opening monologue. Terse, controlled, cinematic
// (matches the §4 persona). ~25s read. Used verbatim by the mock path, handed
// to TTS providers as `firstMessage` / overridden agent prompt for the others.
// ---------------------------------------------------------------------------

export const OPENER_SCRIPT: string = [
  "This line is secure. Listen — we don't have long.",
  "Twelve hours ago one of ours went dark. Codename SABLE. Mid-handoff, mid-sentence, then nothing.",
  "Before SABLE went quiet, a cache was left behind — in the open, hidden in plain sight, somewhere in that room with you right now.",
  "You weren't my first choice. You were my only one in range. So as of this moment, you're activated.",
  "Find SABLE's cache. Confirm it. The instant you have eyes on it, you photograph it and you send it to this number.",
  "I'll be on the other end of every message from here. Do exactly what I tell you, when I tell you, and you walk out of this clean.",
  "Trust the channel. Trust me. Nobody else.",
  "Clock's already running. Move.",
].join(" ");

// Personalized variant — if we know the player's handle we open by name; it
// lands harder in the room. Falls back to the impersonal script otherwise.
function scriptFor(playerHandle?: string): string {
  const h = playerHandle?.trim();
  if (!h) return OPENER_SCRIPT;
  return `${h}. This line is secure, and it's keyed to you. ${OPENER_SCRIPT}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PlaceCallResult {
  ok: boolean;
  provider: string;
  detail?: string;
}

/**
 * Place the Handler's opening call to the player. Dispatches on VOICE_PROVIDER.
 * Never throws — any failure (no creds, network, bad provider) resolves to
 * { ok:false, ... } so the caller can fire-and-forget and let the text mission
 * carry the demo.
 */
export async function placeOpeningCall(a: {
  toPhone: string;
  playerHandle?: string;
}): Promise<PlaceCallResult> {
  const provider = env.voice.provider;
  const script = scriptFor(a.playerHandle);

  try {
    const to = normalizeE164(a.toPhone);
    if (!to) {
      console.warn(`[voice] no/invalid toPhone (${a.toPhone}); skipping opening call.`);
      return { ok: false, provider, detail: "no destination phone" };
    }

    switch (provider) {
      case "twilio":
        return await placeViaTwilio(to, script);
      case "vapi":
        return await placeViaVapi(to, script);
      case "elevenlabs":
        return await placeViaElevenLabs(to, script);
      case "mock":
      default:
        return placeViaMock(to, script, a.playerHandle, provider);
    }
  } catch (err) {
    // Belt-and-suspenders: providers already guard themselves, but never let an
    // unexpected throw escape this module.
    console.error("[voice] placeOpeningCall failed:", err);
    return { ok: false, provider, detail: errText(err) };
  }
}

// ---------------------------------------------------------------------------
// mock — the default. No telephony; just narrate to the server log so the demo
// is fully runnable with zero credits/credentials. Returns ok:true.
// ---------------------------------------------------------------------------

function placeViaMock(
  to: string,
  script: string,
  playerHandle: string | undefined,
  provider: string,
): PlaceCallResult {
  const who = playerHandle ? ` (${playerHandle})` : "";
  console.log(
    [
      "",
      "📞 ── DEAD DROP // OPENING CALL (mock) ───────────────────────────",
      `   → ringing ${to}${who}`,
      `   Handler:`,
      ...wrap(script, 64).map((l) => `     ${l}`),
      "   …call ends. First text incoming.",
      "─────────────────────────────────────────────────────────────────",
      "",
    ].join("\n"),
  );
  // provider is "mock" here, but pass it through so logging/telemetry is honest
  // if some future caller forced the mock path under a different label.
  return { ok: true, provider, detail: "logged (mock)" };
}

// ---------------------------------------------------------------------------
// twilio — outbound call via the REST API + inline TwiML <Say>. No SDK needed
// (keeps the dependency tree clean); plain fetch + Basic auth. Guarded on
// missing creds.
// REST: POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Calls.json
// ---------------------------------------------------------------------------

async function placeViaTwilio(to: string, script: string): Promise<PlaceCallResult> {
  const sid = penv("TWILIO_ACCOUNT_SID");
  const token = penv("TWILIO_AUTH_TOKEN");
  const from = normalizeE164(penv("VOICE_FROM_NUMBER"));
  if (!sid || !token || !from) {
    console.warn("[voice/twilio] missing creds (TWILIO_ACCOUNT_SID/AUTH_TOKEN/VOICE_FROM_NUMBER); skipping call.");
    return { ok: false, provider: "twilio", detail: "no creds" };
  }

  // Inline TwiML: a measured, low-rate <Say> reading the monologue.
  const twiml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Pause length="1"/>` +
    `<Say voice="Polly.Matthew-Neural" language="en-US">${xmlEscape(script)}</Say>` +
    `<Pause length="1"/></Response>`;

  const body = new URLSearchParams({ To: to, From: from, Twiml: twiml });
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
    );
    if (!res.ok) {
      const detail = await safeText(res);
      console.error(`[voice/twilio] call failed ${res.status}: ${detail}`);
      return { ok: false, provider: "twilio", detail: `http ${res.status}` };
    }
    // Twilio returns the Call resource; sid is handy for logs.
    const data = (await safeJson(res)) as { sid?: string } | null;
    console.log(`[voice/twilio] opening call queued → ${to} (sid ${data?.sid ?? "?"})`);
    return { ok: true, provider: "twilio", detail: data?.sid };
  } catch (err) {
    console.error("[voice/twilio] network error:", err);
    return { ok: false, provider: "twilio", detail: errText(err) };
  }
}

// ---------------------------------------------------------------------------
// vapi — outbound AI phone call. We hand the script in as the assistant's
// firstMessage so the opening line is exactly our monologue. Guarded on creds.
// REST: POST https://api.vapi.ai/call  (Bearer VAPI_API_KEY)
// ---------------------------------------------------------------------------

async function placeViaVapi(to: string, script: string): Promise<PlaceCallResult> {
  const key = penv("VAPI_API_KEY");
  const phoneNumberId = penv("VAPI_PHONE_NUMBER_ID");
  const assistantId = penv("VAPI_ASSISTANT_ID"); // optional
  if (!key || !phoneNumberId) {
    console.warn("[voice/vapi] missing creds (VAPI_API_KEY/VAPI_PHONE_NUMBER_ID); skipping call.");
    return { ok: false, provider: "vapi", detail: "no creds" };
  }

  // If a prebuilt assistant is configured we override just its first message;
  // otherwise we inline a minimal transient assistant that opens with — and is
  // instructed to stay on — the Handler's script.
  const assistantOverrides = { firstMessage: script };
  const transientAssistant = {
    firstMessage: script,
    model: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "system",
          content:
            "You are THE HANDLER, a terse, controlled, cinematic spymaster running a live field operative by phone. " +
            "Open with the provided first message verbatim. Keep every turn to 1-2 sentences. Never break character. " +
            "Direct them to photograph the cache and text proof to this line, then end the call. There is a safe word, ABORT.",
        },
      ],
    },
    voice: { provider: "11labs", voiceId: "onwK4e9ZLuTAKqWW03F9" },
  };

  const payload: Record<string, unknown> = assistantId
    ? { phoneNumberId, customer: { number: to }, assistantId, assistantOverrides }
    : { phoneNumberId, customer: { number: to }, assistant: transientAssistant };

  try {
    const res = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await safeText(res);
      console.error(`[voice/vapi] call failed ${res.status}: ${detail}`);
      return { ok: false, provider: "vapi", detail: `http ${res.status}` };
    }
    const data = (await safeJson(res)) as { id?: string } | null;
    console.log(`[voice/vapi] opening call started → ${to} (id ${data?.id ?? "?"})`);
    return { ok: true, provider: "vapi", detail: data?.id };
  } catch (err) {
    console.error("[voice/vapi] network error:", err);
    return { ok: false, provider: "vapi", detail: errText(err) };
  }
}

// ---------------------------------------------------------------------------
// elevenlabs — outbound Conversational-AI call (via their Twilio integration).
// We override the agent's first message with the Handler monologue. Guarded.
// REST: POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call
// ---------------------------------------------------------------------------

async function placeViaElevenLabs(to: string, script: string): Promise<PlaceCallResult> {
  const key = penv("ELEVENLABS_API_KEY");
  const agentId = penv("ELEVENLABS_AGENT_ID");
  const phoneNumberId = penv("ELEVENLABS_PHONE_NUMBER_ID");
  if (!key || !agentId || !phoneNumberId) {
    console.warn(
      "[voice/elevenlabs] missing creds (ELEVENLABS_API_KEY/AGENT_ID/PHONE_NUMBER_ID); skipping call.",
    );
    return { ok: false, provider: "elevenlabs", detail: "no creds" };
  }

  const payload = {
    agent_id: agentId,
    agent_phone_number_id: phoneNumberId,
    to_number: to,
    // Override the agent's opening line with our exact script.
    conversation_initiation_client_data: {
      conversation_config_override: {
        agent: { first_message: script },
      },
    },
  };

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await safeText(res);
      console.error(`[voice/elevenlabs] call failed ${res.status}: ${detail}`);
      return { ok: false, provider: "elevenlabs", detail: `http ${res.status}` };
    }
    const data = (await safeJson(res)) as { callSid?: string; conversation_id?: string } | null;
    const ref = data?.conversation_id ?? data?.callSid ?? "?";
    console.log(`[voice/elevenlabs] opening call started → ${to} (${ref})`);
    return { ok: true, provider: "elevenlabs", detail: ref };
  } catch (err) {
    console.error("[voice/elevenlabs] network error:", err);
    return { ok: false, provider: "elevenlabs", detail: errText(err) };
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Read a provider credential straight from the environment (trimmed, "" → ""). */
function penv(name: string): string {
  const v = process.env[name];
  return v === undefined ? "" : v.trim();
}

/**
 * Loose E.164 normalizer. Accepts "+1 628 264 7656", "16282647656", etc.
 * Returns "" for anything that can't be coerced into a plausible E.164 number,
 * which the caller treats as "no destination" rather than dialing garbage.
 */
function normalizeE164(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return "";
  if (hadPlus) return `+${digits}`;
  // Bare 10-digit US numbers are common in the demo — assume +1.
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

/** XML/TwiML-escape a string for safe inlining in <Say>. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Wrap text to a column width for tidy multi-line console logging. */
function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line.length === 0) {
      line = w;
    } else if (line.length + 1 + w.length <= width) {
      line += ` ${w}`;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
