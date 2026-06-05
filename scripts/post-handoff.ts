// Post — or dry-run preview — the DEAD DROP field-courier bounty on RentAHuman.
//   npx tsx scripts/post-handoff.ts             # DRY RUN (preview, free, nothing posted)
//   LIVE=true npx tsx scripts/post-handoff.ts   # actually publish the bounty (still $0 until you accept someone)
//   PRICE=5 VENUE="Agentic AI SF Hackathon" LIVE=true npx tsx scripts/post-handoff.ts
import "./_env";
import { handoffBounty, createBounty, type BountyResult } from "../src/lib/rentahuman";

async function main() {
  const live = process.env.LIVE === "true";
  const price = Number(process.env.PRICE ?? "5");
  const venue = process.env.VENUE || "Agentic AI SF Hackathon";
  const input = { ...handoffBounty({ price, venue }), dryRun: !live };

  console.log(
    `${live ? `🟢 LIVE POST ($${price})` : "🟡 DRY RUN — preview only, nothing posted, no charge"}\n`,
  );
  console.log("title:      ", input.title);
  console.log("price:      ", `$${input.price} (${input.priceType}) — escrowed only when you accept someone`);
  console.log("evidence:   ", input.evidenceTypes?.join(", "));
  console.log("description:\n  " + input.description + "\n");

  const r: BountyResult = await createBounty(input);
  console.log(
    "result:",
    JSON.stringify({ ok: r.ok, dryRun: r.dryRun, bounty: r.bounty, error: r.error }, null, 2),
  );
  if (!r.ok) {
    if (r.raw) console.error("raw:", JSON.stringify(r.raw).slice(0, 600));
    process.exit(1);
  }
  if (live && r.bounty?.url) console.log(`\n✅ Posted: ${r.bounty.url}`);
  else if (!live) console.log(`\n(Preview valid. Re-run with LIVE=true to publish for $${price}.)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
