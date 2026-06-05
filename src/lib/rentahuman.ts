// RentAHuman — recruit a real human (the field courier for the DEAD DROP
// envelope handoff). This is the "how it scales" beat: the planted teammate
// becomes a real stranger hired on demand. SERVER ONLY (holds the API key).
//
// API: https://rentahuman.ai/api  —  auth via header `X-API-Key: rah_...`.
// Posting a bounty is FREE; the price is only escrowed when you ACCEPT an
// applicant (POST /api/escrow/checkout). So createBounty({dryRun:false})
// publishes an open listing but charges NOTHING until you hire someone.
//
// NEEDS ENV: RENTAHUMAN_API_KEY (rah_...), optional RENTAHUMAN_API_BASE.

const API_BASE = (process.env.RENTAHUMAN_API_BASE || "https://rentahuman.ai/api").replace(/\/+$/, "");

function apiKey(): string {
  return (process.env.RENTAHUMAN_API_KEY || "").trim();
}

export interface BountyInput {
  title: string;
  description: string;
  completionCriteria: string;
  evidenceTypes?: string[]; // "text" | "photo" | "video" | "link"
  estimatedHours?: number; // 0.083–168
  price: number; // USD, min 0.01
  priceType?: "fixed" | "hourly";
  agentType?: string; // "clawdbot" | "moltbot" | "other"
  category?: string;
  // RentAHuman's location is a city-level object (no street field — put the
  // street address in the description). Empty => remote.
  location?: { isRemoteAllowed?: boolean; city?: string; state?: string; country?: string };
  deadline?: string; // ISO 8601
  spotsAvailable?: number; // 1–500
  identityRequired?: boolean;
  dryRun?: boolean;
}

export interface Bounty {
  id?: string;
  title?: string;
  status?: string;
  price?: number;
  url?: string;
  createdAt?: string;
}

export interface BountyResult {
  ok: boolean;
  dryRun: boolean;
  bounty?: Bounty;
  error?: string;
  raw?: unknown;
}

function buildBody(input: BountyInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    completionCriteria: input.completionCriteria,
    evidenceTypes: input.evidenceTypes ?? ["photo", "text"],
    estimatedHours: input.estimatedHours ?? 0.25,
    price: input.price,
    priceType: input.priceType ?? "fixed",
    agentType: input.agentType ?? "other",
    dryRun: input.dryRun ?? false,
  };
  if (input.category) body.category = input.category;
  if (input.location) body.location = input.location;
  if (input.deadline) body.deadline = input.deadline;
  if (input.spotsAvailable != null) body.spotsAvailable = input.spotsAvailable;
  if (input.identityRequired != null) body.identityRequired = input.identityRequired;
  return body;
}

/** Create — or, with dryRun, preview — a bounty. Never throws. */
export async function createBounty(input: BountyInput): Promise<BountyResult> {
  const key = apiKey();
  const dryRun = input.dryRun ?? false;
  if (!key) return { ok: false, dryRun, error: "RENTAHUMAN_API_KEY not set" };
  try {
    const res = await fetch(`${API_BASE}/bounties`, {
      method: "POST",
      headers: { "X-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(input)),
    });
    const raw = (await res.json().catch(() => null)) as
      | { bounty?: Bounty; error?: string; message?: string }
      | null;
    if (!res.ok) {
      return { ok: false, dryRun, error: raw?.error ?? raw?.message ?? `http ${res.status}`, raw };
    }
    return { ok: true, dryRun, bounty: raw?.bounty, raw };
  } catch (err) {
    return { ok: false, dryRun, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Fetch a bounty (status, etc.). Returns the raw JSON. */
export async function getBounty(id: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/bounties/${encodeURIComponent(id)}`, {
    headers: { "X-API-Key": apiKey() },
  });
  return res.json().catch(() => null);
}

/** List the humans who applied to our bounty. Returns the raw JSON. */
export async function listApplications(id: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/bounties/${encodeURIComponent(id)}/applications`, {
    headers: { "X-API-Key": apiKey() },
  });
  return res.json().catch(() => null);
}

/** Take a bounty down (status → "cancelled"). Tries PATCH then POST. Never throws. */
export async function cancelBounty(
  id: string,
): Promise<{ ok: boolean; error?: string; raw?: unknown }> {
  const key = apiKey();
  if (!key) return { ok: false, error: "RENTAHUMAN_API_KEY not set" };
  const url = `${API_BASE}/bounties/${encodeURIComponent(id)}`;
  const headers = { "X-API-Key": key, "Content-Type": "application/json" };
  const body = JSON.stringify({ status: "cancelled" });
  for (const method of ["PATCH", "POST"] as const) {
    try {
      const res = await fetch(url, { method, headers, body });
      const raw = await res.json().catch(() => null);
      if (res.ok) return { ok: true, raw };
      if (res.status !== 404 && res.status !== 405) return { ok: false, error: `http ${res.status}`, raw };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, error: "cancel rejected (PATCH and POST both failed)" };
}

/** The canonical DEAD DROP finale bounty: a courier to hand off the envelope. */
export function handoffBounty(
  opts: { price?: number; venue?: string; city?: string; state?: string; country?: string; deadline?: string } = {},
): BountyInput {
  const venue = opts.venue || "AWS Builder Loft · 525 Market St, San Francisco, CA 94105";
  return {
    title: "Field courier for a live game — hand off a sealed envelope (~5 min)",
    description:
      `We're running a live alternate-reality game at ${venue}. Our team hands you a sealed envelope, ` +
      `then points out the player for you in real time by what they're wearing ` +
      `(e.g. "pink shirt, white hat, center stage"). Walk over, hand it to them with a nod — done. ` +
      `Friendly, out in the open, about 5 minutes. You must be on-site at the venue right now.`,
    completionCriteria:
      "The sealed envelope is delivered to the player we identify by their clothing. " +
      "Reply with a quick photo or note confirming the handoff.",
    evidenceTypes: ["photo", "text"],
    estimatedHours: 0.1,
    price: opts.price ?? 5,
    priceType: "fixed",
    agentType: "other",
    spotsAvailable: 1,
    location: {
      isRemoteAllowed: false,
      city: opts.city || "San Francisco",
      state: opts.state || "CA",
      country: opts.country || "US",
    },
    ...(opts.deadline ? { deadline: opts.deadline } : {}),
  };
}
