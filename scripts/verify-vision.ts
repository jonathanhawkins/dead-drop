// Confirms the vision pipeline end-to-end with a REAL, valid image:
// sharp render -> toJpegDataUrl -> Butterbase AI gateway vision.
//   MOCK_AI=false npm run verify:vision
import "./_env";
import sharp from "sharp";
import { describeImage } from "../src/lib/ai";

async function main() {
  // A synthetic but real "sponsor banner" with readable text + a logo box.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="520">
    <rect width="900" height="520" fill="#0b1020"/>
    <rect x="40" y="40" width="820" height="440" fill="#101a36" stroke="#3b82f6" stroke-width="8"/>
    <circle cx="180" cy="180" r="60" fill="#3b82f6"/>
    <text x="500" y="210" font-family="Arial" font-size="96" fill="#ffffff" text-anchor="middle" font-weight="bold">ROCKETRIDE</text>
    <text x="500" y="320" font-family="Arial" font-size="42" fill="#9ca3af" text-anchor="middle">Agentic AI · SF Hackathon</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  console.log("synthetic banner:", png.length, "bytes");

  const desc = await describeImage(
    "You are a field handler verifying an operative reached the drop. Describe what you see in 1-2 sentences. Is there a sponsor banner or logo, and what text can you read?",
    { bytes: png, mime: "image/png" },
  );
  console.log("\nVISION →", desc);
  if (/rocket|banner|logo|hackathon|sign/i.test(desc)) {
    console.log("\n✅ VISION OK — the gateway read the banner.");
  } else {
    console.log("\n⚠️  Vision returned text but didn't clearly name the banner — inspect above.");
  }
}

main().catch((e) => {
  console.error("\n❌ VISION FAIL\n", e);
  process.exit(1);
});
