// Butterbase server client — talks to the auto-generated PostgREST-style data API
// at {apiUrl}/{table} and the storage endpoints. SERVER ONLY (uses the service
// key, which bypasses RLS). Never import this into a client component.
//
// Verified contract: a GET to {apiUrl}/models returned "Table models not found",
// confirming {apiUrl}/{table} is the data API with PostgREST semantics
// (filters like "eq.value", order "col.desc", select, limit, offset).
import { env } from "./env";

if (typeof window !== "undefined") {
  throw new Error("butterbase.ts is server-only (it holds the service key).");
}

const { apiUrl, apiBase, appId, serviceKey } = env.butterbase;

function headers(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** PostgREST filter map, e.g. { id: "eq.123", status: "eq.current" }. */
export type Filters = Record<string, string>;

export interface SelectOpts {
  filters?: Filters;
  select?: string;
  order?: string; // e.g. "created_at.desc"
  limit?: number;
  offset?: number;
}

function buildQuery(opts: SelectOpts): string {
  const qs = new URLSearchParams();
  if (opts.select) qs.set("select", opts.select);
  if (opts.order) qs.set("order", opts.order);
  if (opts.limit != null) qs.set("limit", String(opts.limit));
  if (opts.offset != null) qs.set("offset", String(opts.offset));
  for (const [k, v] of Object.entries(opts.filters ?? {})) qs.set(k, v);
  return qs.toString();
}

export async function dbSelect<T = Record<string, unknown>>(
  table: string,
  opts: SelectOpts = {},
): Promise<T[]> {
  const res = await fetch(`${apiUrl}/${table}?${buildQuery(opts)}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`dbSelect ${table} ${res.status}: ${await res.text()}`);
  return (await res.json()) as T[];
}

export async function dbSelectOne<T = Record<string, unknown>>(
  table: string,
  opts: SelectOpts = {},
): Promise<T | null> {
  const rows = await dbSelect<T>(table, { ...opts, limit: 1 });
  return rows[0] ?? null;
}

export async function dbInsert<T = Record<string, unknown>>(
  table: string,
  data: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${apiUrl}/${table}`, {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`dbInsert ${table} ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return (Array.isArray(rows) ? rows[0] : rows) as T;
}

// Verified routes: PATCH/DELETE address a single row by primary key in the path
// — {table}/{id}. (Query-filter PATCH/DELETE return 404; DELETE must carry no
// JSON body.) Update/delete by other columns goes through the *Where helpers,
// which select the matching ids first.
export async function dbUpdate<T = Record<string, unknown>>(
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${apiUrl}/${table}/${id}`, {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`dbUpdate ${table}/${id} ${res.status}: ${await res.text()}`);
  const out = await res.json();
  return (Array.isArray(out) ? out[0] : out) as T;
}

export async function dbDelete(table: string, id: string): Promise<void> {
  // No Content-Type / body — the API rejects an empty JSON body on DELETE.
  const res = await fetch(`${apiUrl}/${table}/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) throw new Error(`dbDelete ${table}/${id} ${res.status}: ${await res.text()}`);
}

export async function dbUpdateWhere<T = Record<string, unknown>>(
  table: string,
  filters: Filters,
  patch: Record<string, unknown>,
): Promise<T[]> {
  const rows = await dbSelect<{ id: string }>(table, { filters, select: "id" });
  const out: T[] = [];
  for (const r of rows) out.push(await dbUpdate<T>(table, r.id, patch));
  return out;
}

export async function dbDeleteWhere(table: string, filters: Filters): Promise<number> {
  const rows = await dbSelect<{ id: string }>(table, { filters, select: "id" });
  for (const r of rows) await dbDelete(table, r.id);
  return rows.length;
}

// ---- Storage (presigned upload/download) ----
// Best-effort per the documented endpoints; the primary proof path is the photo
// arriving via iMessage, so storage is the capture-page backup path.
export interface UploadTarget {
  uploadUrl: string;
  objectId: string;
  objectKey?: string;
  expiresIn?: number;
}

export async function storageUploadUrl(
  filename: string,
  contentType: string,
  sizeBytes: number,
  isPublic = false,
): Promise<UploadTarget> {
  const res = await fetch(`${apiBase}/storage/${appId}/upload`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ filename, contentType, sizeBytes, public: isPublic }),
  });
  if (!res.ok) throw new Error(`storageUploadUrl ${res.status}: ${await res.text()}`);
  return (await res.json()) as UploadTarget;
}

export async function storageDownloadUrl(objectId: string): Promise<string> {
  const res = await fetch(`${apiBase}/storage/${appId}/download/${objectId}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`storageDownloadUrl ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { downloadUrl: string };
  return data.downloadUrl;
}

/** Fetch the raw bytes of a stored object (used to feed the vision model). */
export async function storageDownloadBytes(
  objectId: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const url = await storageDownloadUrl(objectId);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`storageDownloadBytes ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return { bytes: Buffer.from(await res.arrayBuffer()), contentType };
}

export const butterbaseInfo = { apiUrl, apiBase, appId };
