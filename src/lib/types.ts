// Shared domain types for DEAD DROP. Pure types only (no runtime deps) so this
// file is safe to import from both server and client code.

// ---- XTrace-role scoped memory ----
export type Scope = "world" | "player" | "handler-secret";
export type FactStatus = "current" | "revised" | "superseded";

export interface Fact {
  id: string;
  scope: Scope;
  subject: string; // a player_id, or the literal "world"
  content: string;
  source: string; // which message/photo/call produced it
  status: FactStatus;
  supersedes?: string | null;
  session_id?: string | null;
  created_at: string;
}

export type FactOp = "assert" | "revise" | "supersede" | "reconcile";

// Realtime mirror row — every memory write lands here and drives the dashboard.
export interface FactLogRow {
  id: string;
  fact_id?: string | null;
  op: FactOp;
  scope: Scope;
  subject: string;
  content?: string | null;
  note?: string | null;
  session_id?: string | null;
  created_at: string;
}

// ---- Game spine: the beats of the demo runbook ----
export type Beat =
  | "intro" // opening call placed; awaiting arrival / first contact
  | "cache_recovered" // proof of presence accepted; cache + courier name revealed
  | "courier_lie" // the lie is planted (player believes a false meeting point)
  | "contradiction" // new intel revises an earlier belief; reconciliation fires
  | "finale_identify" // "what are you wearing" — the real-world actor handoff
  | "solve" // envelope half + earned digital fragment combine
  | "signed_off"; // Handler signs off

export const BEAT_ORDER: Beat[] = [
  "intro",
  "cache_recovered",
  "courier_lie",
  "contradiction",
  "finale_identify",
  "solve",
  "signed_off",
];

// ---- Core records (mirror the Butterbase schema) ----
export interface Player {
  id: string;
  phone: string;
  handle?: string | null;
  created_at: string;
}

export interface Session {
  id: string;
  player_id: string;
  status: "active" | "completed" | "aborted" | string;
  channel: "imessage" | "whatsapp" | string;
  handler_line?: string | null;
  started_at: string;
  ended_at?: string | null;
  created_at: string;
}

export interface GameState {
  id: string;
  session_id: string;
  player_id: string;
  beat: Beat;
  step: number;
  digital_fragment?: string | null;
  final_answer?: string | null;
  wearing?: string | null;
  override_advance: boolean;
  updated_at: string;
  created_at: string;
}

// ---- The message-to-reply loop ----
export type InboundKind = "text" | "image";

// Normalized inbound — produced from a Photon webhook, the local simulator,
// or the capture page. The loop only ever sees this shape.
export interface InboundMessage {
  source: "photon" | "simulator" | "capture";
  channel: "imessage" | "whatsapp";
  photonMessageId?: string; // dedupe key from the webhook
  fromPhone: string; // the player's number (E.164)
  handlerLine: string; // our line that received it
  kind: InboundKind;
  text?: string;
  attachmentGuid?: string; // iMessage attachment GUID — bytes pulled via the SDK
  imageObjectId?: string; // Butterbase storage object id (capture-page path)
  imageDataUrl?: string; // inline data URL (simulator / direct tests)
  gps?: { lat: number; lng: number; accuracy?: number };
  receivedAt: string;
}

export type Classification =
  | "proof_presence"
  | "puzzle_answer"
  | "freeform"
  | "wrong_move";

export interface Verdict {
  ok: boolean;
  confidence: number; // 0..1 — a note, never a hard gate
  note: string;
  visionDescription?: string;
}

// The Handler's next move, ready to deliver through Photon.
export interface HandlerReply {
  text: string;
  beat: Beat;
  classification: Classification;
  reactions?: string[]; // tapbacks to send before/with the reply
  typing?: boolean; // show the "…" bubble first
}

// Result of one full turn through the loop (also handy for the simulator).
export interface TurnResult {
  player: Player;
  session: Session;
  stateBefore: Beat;
  stateAfter: Beat;
  classification: Classification;
  verdict?: Verdict;
  reply: HandlerReply;
  factsWritten: number;
  reconciled: boolean;
}
