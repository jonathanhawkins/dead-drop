// Registers (or reuses) the Photon/Spectrum inbound webhook so iMessage +
// WhatsApp messages get POSTed to our /api/photon/webhook route. Prints the
// signing secret to paste into .env.local as PHOTON_WEBHOOK_SIGNING_SECRET.
//
// Auth is HTTP Basic (PROJECT_ID:PROJECT_SECRET). The endpoint is the Spectrum
// REST API at {PHOTON_API_BASE}/projects/{PHOTON_PROJECT_ID}/webhooks/.
//
//   npm run register-webhook
import "./_env";
import { env } from "../src/lib/env";

// Spectrum webhook objects are loosely typed across versions; we read a few
// possible field names defensively.
interface Webhook {
  id?: string;
  webhookUrl?: string;
  url?: string;
  signingSecret?: string;
  secret?: string;
  signing_secret?: string;
  [k: string]: unknown;
}

const PROJECT_ID = process.env.PHOTON_PROJECT_ID || env.photon.projectId;
const PROJECT_SECRET = process.env.PHOTON_PROJECT_SECRET || env.photon.projectSecret;
const API_BASE = (process.env.PHOTON_API_BASE || env.photon.apiBase).replace(/\/$/, "");
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || env.publicBaseUrl).replace(/\/$/, "");

const WEBHOOK_URL = `${PUBLIC_BASE_URL}/api/photon/webhook`;
const WEBHOOKS_ENDPOINT = `${API_BASE}/projects/${PROJECT_ID}/webhooks/`;

function basicAuthHeader(): string {
  const token = Buffer.from(`${PROJECT_ID}:${PROJECT_SECRET}`).toString("base64");
  return `Basic ${token}`;
}

function signingSecretOf(w: Webhook): string | undefined {
  return w.signingSecret ?? w.secret ?? w.signing_secret;
}

function urlOf(w: Webhook): string | undefined {
  return w.webhookUrl ?? w.url;
}

async function api(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response (e.g. an error page) — keep raw text */
  }
  return { status: res.status, json, text };
}

/** Normalize a list response: APIs sometimes wrap arrays in { data } / { webhooks }. */
function asList(json: unknown): Webhook[] {
  if (Array.isArray(json)) return json as Webhook[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["data", "webhooks", "results", "items"]) {
      if (Array.isArray(obj[key])) return obj[key] as Webhook[];
    }
  }
  return [];
}

function printSecretInstructions(secret: string | undefined) {
  console.log("\n────────────────────────────────────────────────────────");
  if (secret) {
    console.log("Webhook signing secret:\n");
    console.log(`  PHOTON_WEBHOOK_SIGNING_SECRET=${secret}`);
    console.log("\nPaste that line into .env.local (or update the existing one),");
    console.log("then restart `npm run dev` so the webhook route verifies signatures.");
  } else {
    console.log("No signing secret was returned by the API.");
    console.log("If one was shown only on creation, delete the existing webhook in");
    console.log("the Spectrum dashboard and re-run, or set PHOTON_WEBHOOK_SIGNING_SECRET");
    console.log("manually. (Empty secret => the webhook route SKIPS verification in dev.)");
  }
  console.log("────────────────────────────────────────────────────────");
}

async function main() {
  console.log("DEAD DROP — Photon/Spectrum webhook registration\n");

  // Preflight: make sure we have the credentials + a public URL to register.
  const missing: string[] = [];
  if (!PROJECT_ID) missing.push("PHOTON_PROJECT_ID");
  if (!PROJECT_SECRET) missing.push("PHOTON_PROJECT_SECRET");
  if (!PUBLIC_BASE_URL) missing.push("PUBLIC_BASE_URL");
  if (missing.length) {
    console.error(`Missing required env var(s): ${missing.join(", ")}`);
    console.error("Set them in .env.local. PUBLIC_BASE_URL is your cloudflared tunnel");
    console.error("URL (run `npm run tunnel` to get one), e.g. https://abc-123.trycloudflare.com");
    process.exit(1);
  }

  console.log(`Project:      ${PROJECT_ID}`);
  console.log(`API base:     ${API_BASE}`);
  console.log(`Webhook URL:  ${WEBHOOK_URL}\n`);

  // 1) List existing webhooks for this project.
  let existing: Webhook[] = [];
  try {
    const listed = await api("GET", WEBHOOKS_ENDPOINT);
    if (listed.status >= 200 && listed.status < 300) {
      existing = asList(listed.json);
      console.log(`Found ${existing.length} existing webhook(s).`);
    } else {
      console.warn(
        `Could not list webhooks (HTTP ${listed.status}). Proceeding to create.`,
        listed.text.slice(0, 200),
      );
    }
  } catch (e) {
    console.warn("List request failed (continuing to create):", (e as Error).message);
  }

  // 2) Reuse an exact-match webhook if one already points at our URL.
  const match = existing.find((w) => urlOf(w) === WEBHOOK_URL);
  if (match) {
    console.log("→ A webhook already points at this URL. Reusing it.");
    printSecretInstructions(signingSecretOf(match));
    console.log("\n✅ WEBHOOK ready (reused)");
    return;
  }

  // 3) Delete any stale webhooks that point at a *different* /api/photon/webhook
  //    path (typically an old tunnel URL) so we don't fan out duplicate deliveries.
  const stale = existing.filter((w) => {
    const u = urlOf(w);
    return !!u && u !== WEBHOOK_URL && u.endsWith("/api/photon/webhook");
  });
  for (const w of stale) {
    if (!w.id) continue;
    try {
      const del = await api("DELETE", `${WEBHOOKS_ENDPOINT}${w.id}`);
      console.log(
        del.status >= 200 && del.status < 300
          ? `→ deleted stale webhook ${w.id} (${urlOf(w)})`
          : `! could not delete stale webhook ${w.id} (HTTP ${del.status})`,
      );
    } catch (e) {
      console.warn(`! delete failed for ${w.id}:`, (e as Error).message);
    }
  }

  // 4) Create the webhook.
  console.log("\n→ Creating webhook…");
  let created: { status: number; json: unknown; text: string };
  try {
    created = await api("POST", WEBHOOKS_ENDPOINT, { webhookUrl: WEBHOOK_URL });
  } catch (e) {
    console.error("Create request failed:", (e as Error).message);
    process.exit(1);
  }

  if (created.status < 200 || created.status >= 300) {
    console.error(`Create failed (HTTP ${created.status}):`);
    console.error(created.text.slice(0, 500));
    if (created.status === 409) {
      console.error(
        "\n(409 = a webhook for this URL may already exist. Re-run to reuse it,",
      );
      console.error("or delete it in the Spectrum dashboard.)");
    }
    process.exit(1);
  }

  const hook = created.json as Webhook;
  console.log(`→ Created webhook${hook.id ? ` (id ${hook.id})` : ""}.`);
  printSecretInstructions(signingSecretOf(hook));

  console.log("\n✅ WEBHOOK registered");
}

main().catch((e) => {
  console.error("\n❌ WEBHOOK registration FAILED\n", e);
  process.exit(1);
});
