// RocketRide adapter — DEAD DROP "pipeline tool" (FLAG-GATED BONUS, server-only).
//
// RocketRide is the fourth mandatory sponsor tool. The critical message loop runs
// the classifier IN-PROCESS (see `@/lib/game.classify`); this adapter is the
// *real* RocketRide integration that the loop can OPTIONALLY consult first when
// `USE_ROCKETRIDE=true` (env.rocketride.enabled). It connects a `rocketride@1.2`
// client to a local RocketRide engine over WebSocket and runs the illustrative
// `pipelines/handler-loop.pipe` (webhook-source -> agent -> llm_anthropic ->
// response) to classify the player's inbound message.
//
// HARD CONTRACT (per BUILD_SPEC §5 ROLE: rocketride):
//   - `classifyViaRocketRide()` returns `null` on disabled OR on ANY error, so
//     the loop transparently falls back to `game.classify`. It is NEVER on the
//     critical path and must NEVER throw.
//   - Honors the `env.rocketride.enabled` flag. When false, it's an instant
//     no-op (no SDK import side-effects, no connection attempt).
//
// SERVER ONLY: holds the RocketRide API key + opens a WebSocket. Do not import
// into a client component.
import { env } from "@/lib/env";
import type { Classification, InboundMessage } from "@/lib/types";

if (typeof window !== "undefined") {
  throw new Error("rocketride/adapter.ts is server-only (it holds the API key).");
}

/** Public status banner the dashboard/README can read without side effects. */
export const rocketrideStatus: { enabled: boolean } = {
  enabled: env.rocketride.enabled,
};

// ---------------------------------------------------------------------------
// Internal: cached client + pipeline token on globalThis so we connect to the
// engine once per server process (the SDK holds a single shared WebSocket).
// ---------------------------------------------------------------------------

// The rocketride SDK ships its own types but we keep the cached handles loosely
// typed here to avoid leaking SDK types through this module's public surface and
// to survive the package not being importable at edge-build time.
type RRClient = {
  connect: (
    credential?: string,
    options?: { uri?: string; timeout?: number },
  ) => Promise<unknown>;
  disconnect: () => Promise<void>;
  isConnected: () => boolean;
  use: (options: {
    filepath?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK PipelineConfig is broad; we only pass filepath.
    pipeline?: any;
    ttl?: number;
    useExisting?: boolean;
  }) => Promise<{ token: string } & Record<string, unknown>>;
  send: (
    token: string,
    data: string | Uint8Array,
    objinfo?: Record<string, unknown>,
    mimetype?: string,
  ) => Promise<RRPipelineResult | undefined>;
};

interface RRPipelineResult {
  result_types?: Record<string, string>;
  // Dynamic fields keyed by name; "text"/"answers" fields are string[].
  [key: string]: unknown;
}

interface RRCache {
  client: RRClient | null;
  token: string | null;
  // A promise guard so concurrent inbound messages share one connect attempt.
  connecting: Promise<{ client: RRClient; token: string } | null> | null;
  // After a hard failure we stop hammering a dead engine for a cooldown window.
  disabledUntil: number;
}

const g = globalThis as unknown as { __deaddropRocketRide?: RRCache };
function cache(): RRCache {
  if (!g.__deaddropRocketRide) {
    g.__deaddropRocketRide = {
      client: null,
      token: null,
      connecting: null,
      disabledUntil: 0,
    };
  }
  return g.__deaddropRocketRide;
}

// Absolute path to the illustrative pipeline file (loaded server-side by the SDK).
const PIPE_PATH = "pipelines/handler-loop.pipe";

// Keep the bonus path snappy: a dead/slow local engine must never stall a text.
const CONNECT_TIMEOUT_MS = 2500;
const SEND_TIMEOUT_MS = 6000;
// After a failure, back off for 60s before trying the engine again.
const COOLDOWN_MS = 60_000;

/** Race any promise against a timeout so the bonus path can't hang the loop. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`rocketride ${label} timeout`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Lazily import the SDK + connect + start the pipeline once. Never throws. */
async function getReady(): Promise<{ client: RRClient; token: string } | null> {
  const c = cache();

  // Reuse a healthy, already-started pipeline.
  if (c.client && c.token) {
    try {
      if (c.client.isConnected()) return { client: c.client, token: c.token };
    } catch {
      /* fall through and re-init */
    }
  }

  // Respect the post-failure cooldown so we don't reconnect on every message.
  if (Date.now() < c.disabledUntil) return null;

  // Share a single in-flight connect attempt across concurrent callers.
  if (c.connecting) return c.connecting;

  c.connecting = (async () => {
    try {
      // Dynamic import so the SDK (and its ws transport) is only loaded when the
      // flag is on — keeps it off the critical path and out of edge bundles.
      const mod = (await import("rocketride")) as {
        RocketRideClient: new (cfg: {
          auth?: string;
          uri?: string;
        }) => RRClient;
      };
      const client = new mod.RocketRideClient({
        auth: env.rocketride.apiKey,
        uri: env.rocketride.uri,
      });

      await withTimeout(
        client.connect(env.rocketride.apiKey, {
          uri: env.rocketride.uri,
          timeout: CONNECT_TIMEOUT_MS,
        }),
        CONNECT_TIMEOUT_MS,
        "connect",
      );

      // Start (or reuse) the handler-loop pipeline; ttl keeps it warm between
      // messages so we pay the spin-up cost at most once.
      const started = await withTimeout(
        client.use({ filepath: PIPE_PATH, useExisting: true, ttl: 0 }),
        CONNECT_TIMEOUT_MS,
        "use",
      );
      if (!started?.token) throw new Error("rocketride pipeline returned no token");

      c.client = client;
      c.token = started.token;
      return { client, token: started.token };
    } catch (err) {
      // Mark cold + start a cooldown so the loop quietly uses game.classify.
      c.client = null;
      c.token = null;
      c.disabledUntil = Date.now() + COOLDOWN_MS;
      console.warn(
        "[rocketride] engine unavailable — falling back to in-process classify:",
        err instanceof Error ? err.message : err,
      );
      return null;
    } finally {
      c.connecting = null;
    }
  })();

  return c.connecting;
}

/**
 * Extract the first text/answer segment from a RocketRide pipeline result.
 * The result advertises its fields in `result_types` (name -> "text"|"answers");
 * those fields are `string[]`. We coalesce them into one lowercased blob.
 */
function resultText(result: RRPipelineResult | undefined): string {
  if (!result) return "";
  const out: string[] = [];
  const types = result.result_types ?? {};
  for (const [field, kind] of Object.entries(types)) {
    if (kind !== "text" && kind !== "answers") continue;
    const v = result[field];
    if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === "string"));
    else if (typeof v === "string") out.push(v);
  }
  // Fallback: some engines echo a top-level `text`/`answers` field directly.
  if (out.length === 0) {
    for (const key of ["text", "answers", "answer", "classification", "label"]) {
      const v = (result as Record<string, unknown>)[key];
      if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === "string"));
      else if (typeof v === "string") out.push(v);
    }
  }
  return out.join(" ").toLowerCase();
}

/** Map free-form pipeline output onto our four-way Classification union. */
function toClassification(text: string): Classification | null {
  if (!text) return null;
  // Prefer an explicit label if the LLM emitted one of our enum values.
  if (text.includes("proof_presence")) return "proof_presence";
  if (text.includes("puzzle_answer")) return "puzzle_answer";
  if (text.includes("wrong_move")) return "wrong_move";
  if (text.includes("freeform")) return "freeform";
  // Otherwise sniff intent from natural-language output.
  if (text.includes("halcyon") && text.includes("seven")) return "puzzle_answer";
  if (/\b(photo|image|banner|here|arrived|proof|presence)\b/.test(text))
    return "proof_presence";
  if (/\b(wrong|invalid|unclear|unknown|nonsense)\b/.test(text)) return "wrong_move";
  return "freeform";
}

/**
 * Classify an inbound message via the RocketRide pipeline engine.
 *
 * Returns a {@link Classification} when the flag is enabled AND the engine
 * responded with something we can map; returns `null` when disabled or on ANY
 * error so the caller falls back to the deterministic in-process classifier.
 * NEVER throws. NEVER on the critical path.
 */
export async function classifyViaRocketRide(
  input: InboundMessage,
): Promise<Classification | null> {
  if (!env.rocketride.enabled) return null;

  try {
    // Images route straight to proof-of-presence — no need to spin the engine
    // (and the .pipe's webhook source is text-oriented). Still flag-gated.
    if (input.kind === "image" || input.attachmentGuid || input.imageObjectId) {
      return "proof_presence";
    }

    const ready = await getReady();
    if (!ready) return null;

    // Feed the pipeline a compact JSON envelope mirroring the webhook source.
    const payload = JSON.stringify({
      text: input.text ?? "",
      kind: input.kind,
      channel: input.channel,
      from: input.fromPhone,
      task: "classify",
      labels: ["proof_presence", "puzzle_answer", "freeform", "wrong_move"],
    });

    const result = await withTimeout(
      ready.client.send(ready.token, payload, { name: "inbound.json" }, "application/json"),
      SEND_TIMEOUT_MS,
      "send",
    );

    return toClassification(resultText(result));
  } catch (err) {
    // Any failure mid-send: cool down and let the loop use game.classify.
    const c = cache();
    c.disabledUntil = Date.now() + COOLDOWN_MS;
    console.warn(
      "[rocketride] classify failed — falling back to in-process classify:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
