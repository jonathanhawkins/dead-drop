// Validates the realtime path the projector dashboard depends on. Subscribes
// AFTER the server's `connected` frame (subscribing on raw `open` races ahead of
// the gateway and gets dropped), then inserts a fact_log row once `subscribed`
// is acked and confirms the change streams back.
//   npx tsx scripts/verify-realtime.ts
import "./_env";
import { dbInsert, dbDelete } from "../src/lib/butterbase";

const appId = process.env.NEXT_PUBLIC_BUTTERBASE_APP_ID!;
const token = process.env.NEXT_PUBLIC_BUTTERBASE_REALTIME_TOKEN!;
const url = `wss://api.butterbase.ai/v1/${appId}/realtime?token=${encodeURIComponent(token)}`;

async function main() {
  if (typeof WebSocket === "undefined") throw new Error("global WebSocket missing (need Node >= 22)");
  const ws = new WebSocket(url);
  let insertedId: string | null = null;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for change event")), 20000);
    ws.addEventListener("message", async (e: MessageEvent) => {
      let m: Record<string, unknown> = {};
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      console.log("WS ←", m.type, m.table ?? "", m.op ?? "", m.role ? `role=${m.role}` : "");
      if (m.type === "connected") {
        ws.send(JSON.stringify({ type: "subscribe", table: "fact_log" }));
      } else if (m.type === "subscribed" && m.table === "fact_log") {
        const row = await dbInsert<{ id: string }>("fact_log", {
          op: "assert",
          scope: "world",
          subject: "world",
          content: "realtime-test " + Date.now(),
          note: "verify-realtime",
        });
        insertedId = row.id;
        console.log("inserted fact_log", row.id, "→ waiting for it to stream back…");
      } else if (m.type === "change" && m.table === "fact_log") {
        clearTimeout(timer);
        resolve();
      }
    });
    ws.addEventListener("error", () => console.log("WS error event"));
  });

  console.log("\n✅ REALTIME OK — fact_log inserts stream to subscribers (subscribe AFTER 'connected').");
  if (insertedId) await dbDelete("fact_log", insertedId).catch(() => {});
  try {
    ws.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("\n❌ REALTIME FAIL\n", e);
  process.exit(1);
});
