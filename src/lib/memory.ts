// XTrace-role scoped memory — implemented on the Butterbase `facts` table, with
// every write mirrored into `fact_log` (the realtime feed the dashboard renders).
// SERVER ONLY.
//
// The whole point of this module is the scoping discipline:
//   - `world`          : objective truth, subject = "world"
//   - `player`         : a single operative's beliefs, subject = player_id
//   - `handler-secret` : the Handler's private intel, subject = "world"
// reviseBelief() supersedes ONLY `current` facts inside the SAME (subject,scope)
// partition. World truth must NEVER silently correct a player's false belief —
// that gap (Pier 7 lie vs. Old Mint truth) is the drama. The reconciliation only
// happens when the Handler deliberately revises a belief in the player's own
// partition, and that write lands in fact_log with a human-readable note.
import { dbInsert, dbSelect, dbUpdate } from "./butterbase";
import type { Fact, FactOp, FactStatus, Scope } from "./types";
import { WORLD_FACTS } from "./content";

const FACTS = "facts";
const FACT_LOG = "fact_log";

// ---------------------------------------------------------------------------
// fact_log mirror — best-effort. A failure to log must never break a fact
// write (the dashboard is a view, not the source of truth). Wrapped in
// try/catch so the loop degrades gracefully.
// ---------------------------------------------------------------------------
async function logFact(row: {
  fact_id?: string | null;
  op: FactOp;
  scope: Scope;
  subject: string;
  content?: string | null;
  note?: string | null;
  session_id?: string | null;
}): Promise<void> {
  try {
    await dbInsert(FACT_LOG, {
      fact_id: row.fact_id ?? null,
      op: row.op,
      scope: row.scope,
      subject: row.subject,
      content: row.content ?? null,
      note: row.note ?? null,
      session_id: row.session_id ?? null,
    });
  } catch (err) {
    console.error("[memory] fact_log mirror failed:", err);
  }
}

// ---------------------------------------------------------------------------
// assertFact — write a new `current` fact and mirror an `assert` op.
// ---------------------------------------------------------------------------
export async function assertFact(a: {
  scope: Scope;
  subject: string;
  content: string;
  source: string;
  sessionId?: string;
}): Promise<Fact> {
  const fact = await dbInsert<Fact>(FACTS, {
    scope: a.scope,
    subject: a.subject,
    content: a.content,
    source: a.source,
    status: "current" as FactStatus,
    supersedes: null,
    session_id: a.sessionId ?? null,
  });

  await logFact({
    fact_id: fact.id,
    op: "assert",
    scope: a.scope,
    subject: a.subject,
    content: a.content,
    session_id: a.sessionId ?? null,
  });

  return fact;
}

// ---------------------------------------------------------------------------
// reviseBelief — the reconciliation primitive. Within ONE (subject, scope)
// partition: mark matching `current` facts as `superseded`, then write the new
// belief as `current` linking back via `supersedes`. Logs a `supersede` op for
// each retired fact and a `reconcile` op (with a human note) for the new one.
//
// Scoping guarantee: we only ever read/supersede facts where BOTH subject AND
// scope match the new belief. World truth in a different partition is never
// touched, so a player's false belief is corrected only by an intentional
// revision in the player's own partition — never auto-corrected by world facts.
// ---------------------------------------------------------------------------
export async function reviseBelief(a: {
  scope: Scope;
  subject: string;
  newContent: string;
  source: string;
  sessionId?: string;
  /** Narrow which current facts to supersede (default: all current in partition). */
  match?: (f: Fact) => boolean;
}): Promise<{ superseded: Fact[]; created: Fact }> {
  // Read ONLY the same-(subject,scope) current facts. This is the hard wall
  // that keeps world truth from reaching into a player's beliefs.
  let current: Fact[] = [];
  try {
    current = await dbSelect<Fact>(FACTS, {
      filters: {
        subject: `eq.${a.subject}`,
        scope: `eq.${a.scope}`,
        status: "eq.current",
      },
      order: "created_at.asc",
    });
  } catch (err) {
    console.error("[memory] reviseBelief read failed:", err);
  }

  const toSupersede = a.match ? current.filter(a.match) : current;

  const superseded: Fact[] = [];
  for (const old of toSupersede) {
    try {
      const updated = await dbUpdate<Fact>(FACTS, old.id, {
        status: "superseded" as FactStatus,
      });
      superseded.push(updated);
      await logFact({
        fact_id: old.id,
        op: "supersede",
        scope: a.scope,
        subject: a.subject,
        content: old.content,
        note: `superseded by reconciliation: "${a.newContent}"`,
        session_id: a.sessionId ?? null,
      });
    } catch (err) {
      console.error(`[memory] reviseBelief supersede ${old.id} failed:`, err);
    }
  }

  const created = await dbInsert<Fact>(FACTS, {
    scope: a.scope,
    subject: a.subject,
    content: a.newContent,
    source: a.source,
    status: "current" as FactStatus,
    supersedes: superseded[0]?.id ?? null,
    session_id: a.sessionId ?? null,
  });

  // The reconcile op carries the human-readable before→after note for the
  // dashboard to highlight (old struck through, new flashed in).
  const reconNote =
    superseded.length > 0
      ? `reconciled ${superseded.length} belief(s) in ${a.scope}/${a.subject}: ` +
        superseded.map((s) => `"${s.content}"`).join(" + ") +
        ` → "${a.newContent}"`
      : `new belief asserted in ${a.scope}/${a.subject}: "${a.newContent}"`;

  await logFact({
    fact_id: created.id,
    op: "reconcile",
    scope: a.scope,
    subject: a.subject,
    content: a.newContent,
    note: reconNote,
    session_id: a.sessionId ?? null,
  });

  return { superseded, created };
}

// ---------------------------------------------------------------------------
// readScope — read facts for one (subject, scope), optionally filtered by
// status (defaults to `current`). Newest first.
// ---------------------------------------------------------------------------
export async function readScope(
  subject: string,
  scope: Scope,
  status: FactStatus | "all" = "current",
): Promise<Fact[]> {
  const filters: Record<string, string> = {
    subject: `eq.${subject}`,
    scope: `eq.${scope}`,
  };
  if (status !== "all") filters.status = `eq.${status}`;
  try {
    return await dbSelect<Fact>(FACTS, { filters, order: "created_at.desc" });
  } catch (err) {
    console.error("[memory] readScope failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// readPlayerMemory — what the Handler is allowed to recall about an operative:
// objective world truth + that operative's own beliefs. Deliberately EXCLUDES
// handler-secret (the Handler keeps the player one beat behind the truth).
// Returns `current` facts only, newest first.
// ---------------------------------------------------------------------------
export async function readPlayerMemory(
  playerId: string,
): Promise<{ world: Fact[]; player: Fact[] }> {
  const [world, player] = await Promise.all([
    readScope("world", "world", "current"),
    readScope(playerId, "player", "current"),
  ]);
  return { world, player };
}

// ---------------------------------------------------------------------------
// seedWorldFacts — assert content.WORLD_FACTS (world + handler-secret) once.
// Idempotent-ish: skips any fact whose (scope, subject, content) already exists
// as `current`, so re-running the seeder doesn't duplicate the room's truth.
// Returns the number of facts newly written.
// ---------------------------------------------------------------------------
export async function seedWorldFacts(sessionId?: string): Promise<number> {
  // Pull existing world + handler-secret facts once to dedupe against.
  let existing: Fact[] = [];
  try {
    const [w, h] = await Promise.all([
      readScope("world", "world", "all"),
      readScope("world", "handler-secret", "all"),
    ]);
    existing = [...w, ...h];
  } catch (err) {
    console.error("[memory] seedWorldFacts dedupe read failed:", err);
  }
  const seen = new Set(existing.map((f) => `${f.scope}::${f.subject}::${f.content}`));

  let written = 0;
  for (const f of WORLD_FACTS) {
    const key = `${f.scope}::${f.subject}::${f.content}`;
    if (seen.has(key)) continue;
    try {
      await assertFact({
        scope: f.scope,
        subject: f.subject,
        content: f.content,
        source: f.source,
        sessionId,
      });
      seen.add(key);
      written++;
    } catch (err) {
      console.error("[memory] seedWorldFacts assert failed:", err);
    }
  }
  return written;
}
