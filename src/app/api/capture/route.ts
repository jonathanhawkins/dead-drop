// POST /api/capture — the GPS / HTTPS backup proof path.
//
// The mobile capture page (secure context) has already: (1) grabbed geolocation,
// (2) taken/chosen a photo, (3) fetched a presigned URL from
// /api/capture/upload-url and PUT the bytes to Butterbase storage. It now posts
// here with the player's phone, the GPS fix, and the stored photo's objectId.
//
// This route:
//   1. logs an `events` row (kind:"capture", the photo + gps in payload) so the
//      proof is recorded even if the game loop is unavailable;
//   2. best-effort drives the game loop via loop.handleInbound with a normalized
//      InboundMessage{ source:"capture", kind:"image", imageObjectId, gps } so the
//      Handler reacts exactly as it would to an inbound iMessage photo.
//
// Server-only (uses the service key via butterbase + loop). NEVER 500s — every
// failure path returns HTTP 200 with ok:true/false so the phone UI degrades
// gracefully into the "PRESENCE CONFIRMED" state.
//
// Request:  { phone: string; gps?: {lat,lng,accuracy?}; photoObjectId?: string;
//             handle?: string; channel?: "imessage"|"whatsapp" }
// Response: { ok: boolean; eventId?: string; reply?: { text; beat }; beat?; error? }
import { NextResponse } from "next/server";
import { dbInsert, dbSelectOne } from "@/lib/butterbase";
import { env } from "@/lib/env";
import { handleInbound } from "@/lib/loop";
import type { InboundMessage, Player } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Gps {
  lat: number;
  lng: number;
  accuracy?: number;
}

interface CaptureBody {
  phone?: unknown;
  gps?: unknown;
  photoObjectId?: unknown;
  handle?: unknown;
  channel?: unknown;
}

interface EventRow {
  id: string;
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return "+" + trimmed.slice(1).replace(/[^\d]/g, "");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return "";
  // Bare 10-digit US number → assume +1. Otherwise prefix "+".
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function parseGps(raw: unknown): Gps | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const g = raw as Record<string, unknown>;
  const lat = typeof g.lat === "number" ? g.lat : Number(g.lat);
  const lng = typeof g.lng === "number" ? g.lng : Number(g.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  const accuracyRaw = g.accuracy;
  const accuracy =
    typeof accuracyRaw === "number" && Number.isFinite(accuracyRaw) ? accuracyRaw : undefined;
  return { lat, lng, accuracy };
}

export async function POST(req: Request): Promise<Response> {
  let body: CaptureBody;
  try {
    body = (await req.json()) as CaptureBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 200 });
  }

  const phone =
    typeof body.phone === "string" ? normalizePhone(body.phone) : "";
  if (!phone) {
    return NextResponse.json({ ok: false, error: "phone required" }, { status: 200 });
  }

  const gps = parseGps(body.gps);
  const photoObjectId =
    typeof body.photoObjectId === "string" && body.photoObjectId.trim()
      ? body.photoObjectId.trim()
      : undefined;
  const channel: "imessage" | "whatsapp" =
    body.channel === "whatsapp" ? "whatsapp" : env.photon.channel === "whatsapp" ? "whatsapp" : "imessage";

  // Try to associate the capture with an existing session/player so the events
  // row is queryable on the dashboard. Best-effort — never blocks the response.
  let sessionId: string | undefined;
  let playerId: string | undefined;
  try {
    const player = await dbSelectOne<Player>("players", { filters: { phone: `eq.${phone}` } });
    if (player) {
      playerId = player.id;
      const session = await dbSelectOne<{ id: string }>("sessions", {
        filters: { player_id: `eq.${player.id}` },
        order: "created_at.desc",
      });
      if (session) sessionId = session.id;
    }
  } catch (err) {
    console.warn("[capture] could not resolve existing player/session:", err);
  }

  // 1) Log the proof event regardless of game-loop availability.
  let eventId: string | undefined;
  try {
    const ev = await dbInsert<EventRow>("events", {
      session_id: sessionId ?? null,
      player_id: playerId ?? null,
      kind: "capture",
      photo_object_id: photoObjectId ?? null,
      payload: {
        source: "capture",
        phone,
        gps: gps ?? null,
        photoObjectId: photoObjectId ?? null,
        channel,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });
    eventId = ev.id;
  } catch (err) {
    console.error("[capture] failed to log events row:", err);
  }

  // 2) Best-effort: drive the Handler loop so the player gets a real reply.
  //    A capture with no photo is still a valid "I'm here" presence ping.
  let replyText: string | undefined;
  let replyBeat: string | undefined;
  try {
    const inbound: InboundMessage = {
      source: "capture",
      channel,
      fromPhone: phone,
      handlerLine: env.photon.handlerLine,
      kind: "image",
      imageObjectId: photoObjectId,
      gps,
      receivedAt: new Date().toISOString(),
    };
    const { reply } = await handleInbound(inbound);
    replyText = reply.text;
    replyBeat = reply.beat;
  } catch (err) {
    console.error("[capture] handleInbound failed (proof still logged):", err);
  }

  return NextResponse.json(
    {
      ok: true,
      eventId,
      beat: replyBeat,
      reply: replyText ? { text: replyText, beat: replyBeat } : undefined,
    },
    { status: 200 },
  );
}
