// Places the Handler's opening CALL via Twilio to verify the voice setup.
// Reads creds from .env.local (VOICE_PROVIDER, VOICE_FROM_NUMBER, TWILIO_*).
//   npx tsx scripts/verify-voice.ts                       # calls +12133003199
//   TEST_RECIPIENT=+1XXXXXXXXXX npx tsx scripts/verify-voice.ts
import "./_env";
import { placeOpeningCall } from "../src/lib/voice";

async function main() {
  const to = process.env.TEST_RECIPIENT ?? "+12133003199";
  console.log(
    `provider=${process.env.VOICE_PROVIDER}  from=${process.env.VOICE_FROM_NUMBER}  →  ${to}`,
  );
  console.log("placing the opening call…");
  const r = await placeOpeningCall({ toPhone: to, playerHandle: "OPERATIVE" });
  console.log("result:", JSON.stringify(r));
  if (r.ok) {
    console.log(`\n✅ Opening call queued (Twilio sid ${r.detail}). ${to} should ring with the Handler.`);
  } else {
    console.log(`\n❌ Not placed (${r.detail}). Twilio TRIAL accounts can only call VERIFIED numbers —`);
    console.log(`   add ${to} under Console → Phone Numbers → Manage → Verified Caller IDs, or upgrade.`);
  }
  await new Promise((res) => setTimeout(res, 1500)); // let the request flush
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
