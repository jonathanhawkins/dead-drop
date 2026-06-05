// Take a bounty down and repost the corrected handoff bounty (with the venue).
//   BOUNTY_ID=<oldId> npx tsx scripts/fix-handoff.ts             # DRY RUN: preview the corrected post (no cancel, no post)
//   BOUNTY_ID=<oldId> LIVE=true npx tsx scripts/fix-handoff.ts   # cancel <oldId> + publish the corrected bounty
//   VENUE="..." PRICE=5 ... overrides
import "./_env";
import { cancelBounty, createBounty, handoffBounty } from "../src/lib/rentahuman";

async function main() {
  const oldId = process.env.BOUNTY_ID;
  const live = process.env.LIVE === "true";
  const price = Number(process.env.PRICE ?? "5");
  const venue = process.env.VENUE;

  if (oldId && live) {
    console.log(`Taking down old bounty ${oldId}…`);
    const c = await cancelBounty(oldId);
    console.log(c.ok ? "  ✅ cancelled" : `  ⚠️ cancel: ${c.error}`);
  } else if (oldId) {
    console.log(`(DRY RUN — would take down ${oldId} on LIVE=true)`);
  }

  const input = { ...handoffBounty({ price, ...(venue ? { venue } : {}) }), dryRun: !live };
  console.log(`\n${live ? "🟢 LIVE repost" : "🟡 DRY RUN repost (preview only)"} — location: "${input.location}"`);
  const r = await createBounty(input);
  console.log("result:", JSON.stringify({ ok: r.ok, dryRun: r.dryRun, bounty: r.bounty, error: r.error }, null, 2));
  if (r.ok && live && r.bounty?.url) console.log(`\n✅ New bounty: ${r.bounty.url}`);
  if (!r.ok) {
    if (r.raw) console.error("raw:", JSON.stringify(r.raw).slice(0, 500));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
