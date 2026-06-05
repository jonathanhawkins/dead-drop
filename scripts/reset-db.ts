// Wipes all game rows (child → parent order to respect FKs). Use between
// rehearsal runs for a clean slate. Does NOT touch schema.
//   npm run reset
import "./_env";
import { dbSelect, dbDelete } from "../src/lib/butterbase";

const TABLES = [
  "fact_log",
  "facts",
  "events",
  "game_state",
  "messages",
  "sessions",
  "players",
];

async function main() {
  for (const t of TABLES) {
    const rows = await dbSelect<{ id: string }>(t, { select: "id" });
    for (const r of rows) await dbDelete(t, r.id);
    console.log(`cleared ${t}: ${rows.length}`);
  }
  console.log("✅ DB reset complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
