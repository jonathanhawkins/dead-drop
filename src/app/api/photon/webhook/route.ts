// Photon / Spectrum inbound webhook — the front door of the loop.
//
// Contract (BUILD_SPEC §5 ROLE: engine): read the RAW body, verify the HMAC
// signature, parse, ack anything that isn't an inbound message with a fast 200,
// otherwise normalize → loop.handleInbound → photon.sendText. ALWAYS return 200
// (even on internal error) so Photon does not retry-storm us. This route is the
// one place that actually sends; handleInbound only computes the reply.
import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature, toInboundMessage, sendText, sendTyping } from "@/lib/photon";
import { handleInbound } from "@/lib/loop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Untyped Spectrum webhook payload — read defensively. (Internal `any`-ish; not
// part of any exported signature.)
type AnyRecord = Record<string, unknown>;

function asRecord(v: unknown): AnyRecord {
  return v && typeof v === "object" ? (v as AnyRecord) : {};
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // 1) Raw body FIRST — the signature is computed over the exact bytes.
    const rawBody = await req.text();

    // 2) Verify signature (true when valid OR when no secret is configured).
    if (!verifyWebhookSignature(rawBody, req.headers)) {
      console.warn("[webhook] signature verification failed — rejecting (401).");
      // A bad signature is the one case we don't 200: it's not a transient
      // delivery error, and 401 tells a misconfigured sender something is wrong.
      return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
    }

    // 3) Parse JSON (tolerate empties / malformed → ack so Photon stops).
    let payload: AnyRecord = {};
    try {
      payload = asRecord(rawBody ? JSON.parse(rawBody) : {});
    } catch (err) {
      console.warn("[webhook] non-JSON body — acking:", err);
      return NextResponse.json({ ok: true, ignored: "non-json" }, { status: 200 });
    }

    // 4) Only inbound message events drive the loop; everything else is acked.
    const event = typeof payload.event === "string" ? payload.event : undefined;
    if (event !== "messages") {
      return NextResponse.json({ ok: true, ignored: `event:${event ?? "none"}` }, { status: 200 });
    }
    const message = asRecord(payload.message);
    const direction = typeof message.direction === "string" ? message.direction : undefined;
    if (direction && direction !== "inbound") {
      // Outbound/echo/status events — ack, don't process.
      return NextResponse.json({ ok: true, ignored: `direction:${direction}` }, { status: 200 });
    }

    // 5) Normalize → run the turn (handleInbound NEVER throws on the normal path).
    const inbound = toInboundMessage(payload);
    if (!inbound.fromPhone) {
      console.warn("[webhook] inbound has no sender phone — acking.");
      return NextResponse.json({ ok: true, ignored: "no-sender" }, { status: 200 });
    }

    // Show the "…" bubble NOW, before the slow (~10s) AI turn, so the operative
    // sees the Handler "typing" through generation instead of a dead pause. The
    // sendText below re-arms/stops typing around delivery; this just makes it
    // appear early and persist. BEST-EFFORT: fully isolated so it can never block
    // the loop, throw, or change the always-200 contract. No-ops if unsupported.
    try {
      await sendTyping(inbound.fromPhone, true);
    } catch (err) {
      console.warn("[webhook] sendTyping(true) failed (ignored — best-effort):", err);
    }

    const { reply } = await handleInbound(inbound);

    // 6) Deliver the Handler's reply (a blank text = dedupe/no-op → send nothing).
    if (reply.text && reply.text.trim()) {
      // sendText is itself fully guarded (mock + try/catch → log), but we wrap
      // again so a thrown rejection can never escape this handler.
      try {
        await sendText(inbound.fromPhone, reply.text, {
          reactions: reply.reactions,
          typing: reply.typing,
          channel: inbound.channel,
        });
      } catch (err) {
        console.error("[webhook] sendText threw (ignored — already logged):", err);
      }
    }

    return NextResponse.json(
      { ok: true, beat: reply.beat, classification: reply.classification },
      { status: 200 },
    );
  } catch (err) {
    // The cardinal rule: NEVER 500 to Photon. Log loudly, ack, move on.
    console.error("[webhook] unhandled error (acking 200 to avoid retries):", err);
    return NextResponse.json({ ok: false, handled: true }, { status: 200 });
  }
}

// Some webhook providers probe with a GET to validate the URL. Answer it.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, service: "deaddrop-photon-webhook" }, { status: 200 });
}
