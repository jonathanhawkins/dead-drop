// Photon / Spectrum bridge (iMessage + WhatsApp) — SERVER ONLY.
//
// Owns every interaction with the `spectrum-ts` SDK so the rest of the app can
// stay SDK-agnostic. Three jobs:
//   1. Verify the inbound webhook signature (HMAC-SHA256 over `v0:{ts}:{body}`).
//   2. Normalize a Spectrum webhook payload into our InboundMessage shape.
//   3. Deliver outbound text (+ tapbacks + typing) and pull attachment bytes.
//
// Hard rules honored here:
//   - MOCK_PHOTON → never touch the SDK; log + no-op (so `npm run simulate`
//     works with no Photon project / credits).
//   - Every SDK / crypto call is wrapped in try/catch. If init fails (e.g. no
//     network) delivery degrades to logging — the demo NEVER crashes on send,
//     and the webhook route NEVER 500s because of us.
//
// The Spectrum factory is async, so we cache the *promise* on globalThis. That
// gives us a lazy singleton that (a) survives Next.js HMR in dev and (b) lets
// concurrent webhook deliveries share a single in-flight init.
import crypto from "node:crypto";
import { Spectrum, Emoji } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import type { InboundMessage, InboundKind } from "./types";
import { env } from "./env";

if (typeof window !== "undefined") {
  throw new Error("photon.ts is server-only (it holds the Photon project secret).");
}

// ---------------------------------------------------------------------------
// SDK shapes
//
// The spectrum-ts generic types are extremely heavy and the provider instance
// is resolved through conditional/never types that don't simplify cleanly in
// app code. We pin the *exact* runtime surface we use to small local interfaces
// and cast the SDK result to them once, at the boundary. (Internal `any` for an
// untyped-at-our-callsite SDK payload — never leaks into an exported signature.)
// ---------------------------------------------------------------------------
interface SpectrumAttachment {
  id: string;
  name?: string;
  mimeType: string;
  size?: number;
  read(): Promise<Buffer>;
}

interface SpectrumSpace {
  send(content: string): Promise<SpectrumMessage | undefined>;
  startTyping?(): Promise<void>;
  stopTyping?(): Promise<void>;
}

interface SpectrumMessage {
  react(reaction: string): Promise<void>;
}

interface IMessageInstance {
  // `im.user("+1...")` -> resolved user handle.
  user(userID: string): Promise<unknown>;
  // `im.space(user)` / `im.space(user, { phone })` to pin our handler line.
  space(user: unknown, params?: { phone?: string }): Promise<SpectrumSpace>;
  // iMessage-only action: pull a received attachment's bytes by GUID.
  getAttachment(guid: string, phone?: string): Promise<SpectrumAttachment | undefined>;
}

// The cached Spectrum app is only ever handed to `imessage(app)`, so the loose
// type here never escapes this module.
type SpectrumApp = Awaited<ReturnType<typeof Spectrum>>;

// ---------------------------------------------------------------------------
// Lazy singleton (cached on globalThis so it survives HMR)
// ---------------------------------------------------------------------------
const GLOBAL_KEY = "__deaddrop_spectrum_app__" as const;
type GlobalWithSpectrum = typeof globalThis & {
  [GLOBAL_KEY]?: Promise<SpectrumApp> | null;
};
const g = globalThis as GlobalWithSpectrum;

function getSpectrumApp(): Promise<SpectrumApp> {
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = (async () => {
      try {
        const app = await Spectrum({
          projectId: env.photon.projectId,
          projectSecret: env.photon.projectSecret,
          providers: [imessage.config()],
        });
        console.log("[photon] Spectrum app initialized");
        return app;
      } catch (err) {
        // Drop the rejected promise so a later send can retry init (e.g. once
        // connectivity returns). Callers below catch this and fall back to log.
        g[GLOBAL_KEY] = null;
        console.error("[photon] Spectrum init failed:", err);
        throw err;
      }
    })();
  }
  return g[GLOBAL_KEY];
}

/** Resolve the iMessage provider instance bound to the singleton app. */
async function getIM(): Promise<IMessageInstance> {
  const app = await getSpectrumApp();
  // `imessage(app)` returns the provider instance. The Platform callable is
  // overloaded (it also accepts a Space/Message), so we route through a single
  // untyped boundary: cast the app to the loose factory call, then cast the
  // resolved instance to our minimal runtime surface. (Untyped SDK boundary —
  // never escapes this module / any exported signature.)
  const instance = (imessage as unknown as (app: unknown) => unknown)(app);
  return instance as IMessageInstance;
}

/**
 * Connectivity pre-flight: force the Spectrum singleton to initialize and bind
 * the iMessage provider, reporting whether the real SDK could authenticate with
 * the configured project creds. Does NOT send anything. Bounded to 15s so a
 * hung init can't wedge a caller. Never throws.
 */
export async function pingPhoton(): Promise<{ ok: boolean; detail: string }> {
  if (env.photon.mock) {
    return { ok: false, detail: "MOCK_PHOTON is on — set MOCK_PHOTON=false to test the real SDK" };
  }
  try {
    await Promise.race([
      getIM(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Spectrum init timed out after 15s")), 15000),
      ),
    ]);
    return { ok: true, detail: "Spectrum app initialized + iMessage provider bound" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// 1. Webhook signature verification
// ---------------------------------------------------------------------------
/**
 * Verify `X-Spectrum-Signature: v0=<hex>` = HMAC-SHA256 of `v0:{timestamp}:{rawBody}`
 * keyed by the webhook signing secret.
 *
 * Returns `true` when valid OR when no secret is configured (dev mode — warns).
 * Any error (malformed header, crypto failure) returns `false`. The webhook
 * route decides policy; we only ever report, never throw.
 */
export function verifyWebhookSignature(rawBody: string, headers: Headers): boolean {
  const secret = env.photon.webhookSigningSecret;
  if (!secret) {
    console.warn(
      "[photon] PHOTON_WEBHOOK_SIGNING_SECRET is empty — skipping webhook signature verification (dev mode).",
    );
    return true;
  }
  try {
    const sigHeader =
      headers.get("x-spectrum-signature") ?? headers.get("X-Spectrum-Signature") ?? "";
    const tsHeader =
      headers.get("x-spectrum-timestamp") ??
      headers.get("X-Spectrum-Timestamp") ??
      headers.get("x-spectrum-request-timestamp") ??
      "";
    if (!sigHeader) {
      console.warn("[photon] missing X-Spectrum-Signature header — rejecting.");
      return false;
    }
    // Header is "v0=<hex>"; tolerate a bare hex too.
    const provided = sigHeader.includes("=") ? sigHeader.split("=").slice(1).join("=") : sigHeader;
    const base = `v0:${tsHeader}:${rawBody}`;
    const expected = crypto.createHmac("sha256", secret).update(base).digest("hex");
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (err) {
    console.error("[photon] signature verification error:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 2. Webhook payload -> InboundMessage
// ---------------------------------------------------------------------------
// Untyped SDK webhook payload — we read it defensively (any-typed on purpose;
// see the field map in BUILD_SPEC §3). Not part of any exported signature.
type AnyRecord = Record<string, unknown>;

function asRecord(v: unknown): AnyRecord {
  return v && typeof v === "object" ? (v as AnyRecord) : {};
}
function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/**
 * Map a Spectrum inbound webhook payload to our normalized InboundMessage
 * (`source: "photon"`). Resilient to small shape differences across providers:
 * the player's number is `message.sender.id`, our line is `space.phone`, and the
 * content is either `{ type:"text", text }` or `{ type:"attachment", id, ... }`.
 */
export function toInboundMessage(payload: unknown): InboundMessage {
  const root = asRecord(payload);
  const space = asRecord(root.space);
  const message = asRecord(root.message);
  const sender = asRecord(message.sender);
  const content = asRecord(message.content);

  const handlerLine = asString(space.phone) ?? env.photon.handlerLine;
  const fromPhone = asString(sender.id) ?? asString(message.sender) ?? "";
  const photonMessageId = asString(message.id);

  // Channel: prefer an explicit provider/channel hint, else fall back to the
  // configured default. iMessage and WhatsApp are the two we support.
  const channelHint = (
    asString(root.provider) ??
    asString(root.channel) ??
    asString(space.platform) ??
    env.photon.channel
  ).toLowerCase();
  const channel: "imessage" | "whatsapp" =
    channelHint.includes("whats") ? "whatsapp" : "imessage";

  const contentType = asString(content.type);
  const isAttachment = contentType === "attachment" || contentType === "image";
  const kind: InboundKind = isAttachment ? "image" : "text";

  const base: InboundMessage = {
    source: "photon",
    channel,
    photonMessageId,
    fromPhone,
    handlerLine,
    kind,
    receivedAt: new Date().toISOString(),
  };

  if (isAttachment) {
    // Inbound photo carries only a GUID — bytes are pulled later via the SDK.
    base.attachmentGuid = asString(content.id) ?? asString(content.guid);
    // Some payloads include a caption alongside an attachment.
    const caption = asString(content.text) ?? asString(content.caption);
    if (caption) base.text = caption;
  } else {
    base.text = asString(content.text) ?? asString(message.text) ?? "";
  }

  return base;
}

// ---------------------------------------------------------------------------
// 3a. Pull attachment bytes (HEIC/any) for the vision model
// ---------------------------------------------------------------------------
/**
 * Fetch the raw bytes of an inbound iMessage attachment via the SDK:
 * `im.getAttachment(guid, handlerLine).read()`. The caller (loop) hands the
 * bytes + mime to `ai.toJpegDataUrl` / `ai.describeImage`.
 *
 * Throws on hard failure (no bytes available) so the caller can decide to fall
 * back; the loop wraps this and degrades to a neutral verdict. Honors
 * MOCK_PHOTON by throwing a clear "mocked" error (the simulator path supplies
 * an inline `imageDataUrl` instead, so this is never hit under mocks).
 */
export async function fetchAttachmentBytes(
  guid: string,
  handlerLine: string,
): Promise<{ bytes: Buffer; mime: string }> {
  if (env.photon.mock) {
    console.log(`[photon][MOCK] fetchAttachmentBytes(${guid}) — no SDK in mock mode.`);
    throw new Error("photon mocked: no attachment bytes (supply imageDataUrl instead)");
  }
  const im = await getIM();
  const attachment = await im.getAttachment(guid, handlerLine);
  if (!attachment) {
    throw new Error(`[photon] attachment ${guid} not found`);
  }
  const bytes = await attachment.read();
  const mime = attachment.mimeType || "application/octet-stream";
  return { bytes, mime };
}

// ---------------------------------------------------------------------------
// 3b. Send text (+ tapbacks + typing)
// ---------------------------------------------------------------------------
// Map our friendly tapback names to emoji glyphs via the SDK's Emoji table.
// `message.react` takes a string; iMessage tapbacks correspond to these keys.
const REACTION_GLYPHS: Record<string, string> = {
  love: Emoji.love,
  like: Emoji.like,
  laugh: Emoji.laugh,
  emphasize: Emoji.emphasize,
  question: Emoji.question,
  dislike: Emoji.dislike,
};

function toReactionGlyph(name: string): string {
  return REACTION_GLYPHS[name.toLowerCase()] ?? name;
}

/**
 * Resolve the pinned space (our handler line -> the player's number). Best
 * effort to pin via `{ phone: handlerLine }`; if the provider rejects the
 * params shape we retry without it so a single-line project still works.
 */
async function resolveSpace(toPhone: string): Promise<SpectrumSpace> {
  const im = await getIM();
  const user = await im.user(toPhone);
  try {
    return await im.space(user, { phone: env.photon.handlerLine });
  } catch (err) {
    console.warn("[photon] space() with pinned line failed, retrying unpinned:", err);
    return im.space(user);
  }
}

/**
 * Send a text message to `toPhone` through Photon, optionally preceding it with
 * a typing indicator and following with tapback reactions on the sent message.
 *
 * NEVER throws: on MOCK_PHOTON it logs; on any SDK failure it logs and returns.
 * Delivery failing must not crash the loop or the webhook.
 */
export async function sendText(
  toPhone: string,
  text: string,
  opts?: { reactions?: string[]; typing?: boolean; channel?: "imessage" | "whatsapp" },
): Promise<void> {
  if (env.photon.mock) {
    const extras: string[] = [];
    if (opts?.typing) extras.push("typing");
    if (opts?.reactions?.length) extras.push(`reactions=${opts.reactions.join(",")}`);
    console.log(
      `[photon][MOCK] -> ${toPhone}${extras.length ? ` (${extras.join(", ")})` : ""}: ${text}`,
    );
    return;
  }

  try {
    const space = await resolveSpace(toPhone);

    // Typing bubble first (best-effort — ignore if unsupported).
    if (opts?.typing && space.startTyping) {
      try {
        await space.startTyping();
      } catch (err) {
        console.warn("[photon] startTyping failed (ignored):", err);
      }
    }

    const sent = await space.send(text);

    // Stop typing best-effort once the message is out.
    if (opts?.typing && space.stopTyping) {
      try {
        await space.stopTyping();
      } catch {
        /* ignore */
      }
    }

    // Apply tapbacks to the message we just sent (best-effort, one at a time).
    if (sent && opts?.reactions?.length) {
      for (const name of opts.reactions) {
        try {
          await sent.react(toReactionGlyph(name));
        } catch (err) {
          console.warn(`[photon] react("${name}") failed (ignored):`, err);
        }
      }
    }

    console.log(`[photon] sent -> ${toPhone}: ${text.slice(0, 80)}`);
  } catch (err) {
    // The whole point: delivery failure degrades to a log, never a throw.
    console.error(`[photon] sendText failed (falling back to log) -> ${toPhone}: ${text}`, err);
  }
}

/**
 * Toggle the typing indicator for a conversation. Pure best-effort: mocked under
 * MOCK_PHOTON, and any SDK failure is swallowed (platforms without a typing API
 * silently no-op upstream too).
 */
export async function sendTyping(toPhone: string, on: boolean): Promise<void> {
  if (env.photon.mock) {
    console.log(`[photon][MOCK] typing ${on ? "start" : "stop"} -> ${toPhone}`);
    return;
  }
  try {
    const space = await resolveSpace(toPhone);
    if (on) {
      if (space.startTyping) await space.startTyping();
    } else if (space.stopTyping) {
      await space.stopTyping();
    }
  } catch (err) {
    console.warn(`[photon] sendTyping(${on}) failed (ignored) -> ${toPhone}:`, err);
  }
}
