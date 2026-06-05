// Seeds the XTrace-role scoped memory with the canonical world + handler-secret
// facts for DEAD DROP. These are the immutable truths the Handler reasons over
// (the real meeting point, the operative, etc.) — distinct from the per-player
// beliefs (including the planted lie) that the game writes at runtime.
//
// Idempotent-ish: memory.seedWorldFacts only inserts facts that aren't already
// present, so re-running won't duplicate the world canon.
//
//   npm run seed
import "./_env";
import { seedWorldFacts, readScope } from "../src/lib/memory";
import { WORLD_FACTS, CANON } from "../src/lib/content";
import type { Scope } from "../src/lib/types";

function groupByScope(facts: { scope: Scope }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of facts) out[f.scope] = (out[f.scope] ?? 0) + 1;
  return out;
}

async function main() {
  console.log("DEAD DROP — seeding scoped memory (XTrace role: facts table)\n");

  // What's defined in the canon content (the source of truth for the seed).
  const defined = groupByScope(WORLD_FACTS);
  console.log(`content.WORLD_FACTS defines ${WORLD_FACTS.length} fact(s):`);
  for (const [scope, n] of Object.entries(defined)) {
    console.log(`  • ${scope.padEnd(16)} ${n}`);
  }
  console.log();

  // Write them (idempotent-ish). Returns the number actually inserted this run.
  const inserted = await seedWorldFacts();
  console.log(
    inserted > 0
      ? `→ inserted ${inserted} new world/handler-secret fact(s).`
      : "→ no new facts inserted (world canon already seeded).",
  );

  // Read back the live state so the operator can eyeball the canon.
  console.log("\nLive facts now in scope:");
  for (const scope of ["world", "handler-secret"] as const) {
    let live: Awaited<ReturnType<typeof readScope>> = [];
    try {
      live = await readScope("world", scope, "current");
    } catch (e) {
      console.warn(`  ! could not read scope "${scope}":`, (e as Error).message);
    }
    console.log(`\n  [${scope}] (${live.length})`);
    for (const f of live) console.log(`    - ${f.content}`);
  }

  // Echo the canon constants so the seed output is a quick reference card.
  console.log("\nCanon reference (content.CANON):");
  for (const [k, v] of Object.entries(CANON)) {
    console.log(`  ${k.padEnd(22)} ${String(v)}`);
  }

  console.log("\n✅ SEED complete");
}

main().catch((e) => {
  console.error("\n❌ SEED FAILED\n", e);
  process.exit(1);
});
