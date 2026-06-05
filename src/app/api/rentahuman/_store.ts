// Server-only glue between our API routes and src/lib/rentahuman.ts.
//
// Two jobs:
//   1) Persist the id of the most-recently-posted handoff bounty so GET /status
//      can find OURS again after a reload. We can't add a schema, so we stash it
//      in the existing `events` table (kind "rentahuman_bounty") and read back the
//      newest such row. This survives dev-server reloads (it's a DB row).
//   2) Shape the RentAHuman REST payloads (which return loose JSON) into the
//      typed objects the dashboard panel renders.
//
// SERVER ONLY — imports butterbase (service key) + rentahuman (RAH api key).
import { dbInsert, dbSelectOne } from "@/lib/butterbase";
import { getBounty, listApplications, type Bounty } from "@/lib/rentahuman";

if (typeof window !== "undefined") {
  throw new Error("rentahuman/_store.ts is server-only (it reaches secret-bearing modules).");
}

const EVENT_KIND = "rentahuman_bounty";

/** The bounty shape the dashboard panel consumes. */
export interface CourierBounty {
  id: string;
  title: string;
  price: number | null;
  priceType: string | null;
  status: string;
  url: string;
  depositUrl: string | null;
  applicationCount: number;
  spotsRemaining: number | null;
  createdAt: string | null;
}

/** One applicant, normalized from the RAH applications payload. */
export interface CourierApplication {
  id: string;
  name: string;
  status: string | null;
  message: string | null;
  appliedAt: string | null;
}

export interface CourierStatus {
  posted: boolean;
  bounty?: CourierBounty;
  applications?: CourierApplication[];
}

// RentAHuman has no public per-bounty URL field, so synthesize the canonical one.
function bountyUrl(id: string): string {
  return `https://rentahuman.ai/bounties/${id}`;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Remember the bounty we just posted (LIVE only — a dry-run posts nothing).
 * Best-effort: a persistence failure must not fail the post itself.
 */
export async function rememberPostedBounty(bounty: Bounty | undefined): Promise<void> {
  const id = bounty?.id;
  if (!id) return;
  try {
    await dbInsert("events", {
      kind: EVENT_KIND,
      payload: {
        bountyId: id,
        title: bounty?.title ?? null,
        price: bounty?.price ?? null,
        url: bounty?.url ?? bountyUrl(id),
        postedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[rentahuman/_store] could not persist bounty id (ignored):", err);
  }
}

/** The id of the most-recently-posted bounty, or null if we've never posted. */
export async function lastPostedBountyId(): Promise<string | null> {
  try {
    const row = await dbSelectOne<{ payload?: { bountyId?: string } | null }>("events", {
      filters: { kind: `eq.${EVENT_KIND}` },
      order: "created_at.desc",
    });
    const id = row?.payload?.bountyId;
    return typeof id === "string" && id ? id : null;
  } catch (err) {
    console.error("[rentahuman/_store] could not read last bounty id:", err);
    return null;
  }
}

/** Shape a raw RAH bounty object (from GET /bounties/:id) into CourierBounty. */
export function shapeBounty(id: string, raw: unknown): CourierBounty {
  // GET /bounties/:id wraps as { success, bounty } in the same style as create.
  const env = asRecord(raw);
  const b = asRecord(env.bounty ?? env);
  return {
    id: str(b.id) ?? id,
    title: str(b.title) ?? "Field courier — envelope handoff",
    price: num(b.price),
    priceType: str(b.priceType),
    status: str(b.status) ?? "unknown",
    url: str(b.url) ?? bountyUrl(str(b.id) ?? id),
    depositUrl: str(env.deposit_url) ?? str(b.depositUrl),
    applicationCount: num(b.applicationCount) ?? 0,
    spotsRemaining: num(b.spotsRemaining),
    createdAt: str(b.createdAt),
  };
}

/** Shape the raw applications payload into a normalized, newest-first list. */
export function shapeApplications(raw: unknown): CourierApplication[] {
  const env = asRecord(raw);
  const listSource =
    (Array.isArray(env.applications) && env.applications) ||
    (Array.isArray(env.data) && env.data) ||
    (Array.isArray(raw) ? (raw as unknown[]) : []);
  const out: CourierApplication[] = [];
  for (const item of listSource) {
    const a = asRecord(item);
    const human = asRecord(a.human ?? a.applicant ?? a.profile);
    const id =
      str(a.id) ?? str(a.applicationId) ?? str(human.id) ?? `app-${out.length}`;
    const name =
      str(a.name) ??
      str(human.name) ??
      str(human.displayName) ??
      str(a.humanName) ??
      "A human";
    out.push({
      id,
      name,
      status: str(a.status),
      message: str(a.message) ?? str(a.coverLetter) ?? str(a.note),
      appliedAt: str(a.createdAt) ?? str(a.appliedAt),
    });
  }
  // Newest first when we have timestamps.
  out.sort((x, y) => {
    if (!x.appliedAt || !y.appliedAt) return 0;
    return x.appliedAt < y.appliedAt ? 1 : x.appliedAt > y.appliedAt ? -1 : 0;
  });
  return out;
}

/**
 * Resolve our current handoff bounty + its applicants for the dashboard.
 * Degrades to { posted:false } when we've never posted (or the lookup fails).
 */
export async function currentCourierStatus(): Promise<CourierStatus> {
  const id = await lastPostedBountyId();
  if (!id) return { posted: false };

  const [bountyRaw, appsRaw] = await Promise.all([
    getBounty(id).catch((err) => {
      console.error("[rentahuman/_store] getBounty failed:", err);
      return null;
    }),
    listApplications(id).catch((err) => {
      console.error("[rentahuman/_store] listApplications failed:", err);
      return null;
    }),
  ]);

  // If the bounty fetch came back empty/erroring, still report it as posted using
  // the persisted id so the panel keeps showing the listing (and the apps count).
  const bounty = shapeBounty(id, bountyRaw);
  const applications = shapeApplications(appsRaw);
  // Keep the headline count honest if the bounty object lagged the apps list.
  if (applications.length > bounty.applicationCount) {
    bounty.applicationCount = applications.length;
  }
  return { posted: true, bounty, applications };
}
