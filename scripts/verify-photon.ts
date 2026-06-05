// Pre-flight for the OUTBOUND iMessage path. First pings the Spectrum SDK
// (validates init/auth with the real project creds, no send). Then, if you set
// TEST_RECIPIENT, sends a real comms-check iMessage so you can confirm delivery.
//
//   npx tsx scripts/verify-photon.ts                              # connectivity only
//   TEST_RECIPIENT=+1XXXXXXXXXX npx tsx scripts/verify-photon.ts  # + real send
import "./_env";
process.env.MOCK_PHOTON = "false"; // force the REAL SDK for this check

async function main() {
  const photon = await import("../src/lib/photon");

  console.log("Pinging Spectrum (real SDK init / auth)…");
  const ping = await photon.pingPhoton();
  console.log(`  ${ping.ok ? "✅ OK" : "❌ FAIL"} — ${ping.detail}\n`);

  const to = process.env.TEST_RECIPIENT;
  if (!to) {
    console.log("Connectivity checked. To also send a real comms-check iMessage:");
    console.log("  TEST_RECIPIENT=+14155550123 npx tsx scripts/verify-photon.ts");
    process.exit(ping.ok ? 0 : 1);
  }

  console.log(`Sending comms-check iMessage to ${to} via Spectrum (REAL send)…\n`);
  await photon.sendText(
    to,
    "DEAD DROP // comms check — the Handler is online. Text this number to begin.",
  );
  console.log("\nsendText returned. Any SDK error was logged above (it never throws).");
  console.log("→ If it arrived in the recipient's Messages, the OUTBOUND path is GO.");
  await new Promise((r) => setTimeout(r, 2500)); // let the gRPC send flush
}

main().catch((e) => {
  console.error("PHOTON CHECK FAIL", e);
  process.exit(1);
});
