// Verifies the bedrock: the Butterbase REST data client (insert/select/update/
// delete round-trip) and, optionally, one real AI gateway call.
//   npm run verify:bedrock              # DB only (AI mocked)
//   MOCK_AI=false AI_MODEL=anthropic/claude-haiku-4.5 npm run verify:bedrock
import "./_env";
import { dbInsert, dbSelect, dbUpdate, dbDelete } from "../src/lib/butterbase";
import { complete } from "../src/lib/ai";

async function main() {
  const phone = `+1999${Date.now().toString().slice(-7)}`;
  console.log("→ insert player", phone);
  const p = await dbInsert<{ id: string }>("players", { phone, handle: "bedrock-test" });
  console.log("  id =", p.id);

  const got = await dbSelect<{ phone: string }>("players", { filters: { id: `eq.${p.id}` } });
  console.log("→ select:", got.length, "row(s),", got[0]?.phone);

  const upd = await dbUpdate<{ handle: string }>("players", p.id, {
    handle: "bedrock-test-2",
  });
  console.log("→ update:", upd?.handle);

  await dbDelete("players", p.id);
  const after = await dbSelect("players", { filters: { id: `eq.${p.id}` } });
  console.log("→ delete: rows remaining =", after.length);

  if (process.env.MOCK_AI === "false") {
    console.log("→ AI gateway test…");
    const line = await complete(
      "You are a terse spymaster handler.",
      "Reply with exactly: channel open",
      { maxTokens: 16 },
    );
    console.log("  AI:", JSON.stringify(line));
  } else {
    console.log("→ AI: skipped (MOCK_AI). Set MOCK_AI=false to test the gateway.");
  }

  console.log("\n✅ BEDROCK OK");
}

main().catch((e) => {
  console.error("\n❌ BEDROCK FAIL\n", e);
  process.exit(1);
});
