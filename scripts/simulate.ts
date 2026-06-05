// End-to-end simulator — drives a full mission through the loop with NO phone,
// NO Photon credits, NO AI spend. Run it with the mocks on:
//
//   MOCK_AI=true MOCK_PHOTON=true npm run simulate
//
// (package.json `simulate` already points here. The mocks default to the values
// in .env.local; set them on the command line to be sure.)
//
// It feeds one scripted turn per beat — a fake banner photo, then the texts that
// carry the operative through cache → contradiction → identify → solve → sign-off
// — and prints the Handler's reply, the beat transition, and how many scoped
// facts each turn wrote. This is the engine's smoke test: if the arc lands on
// `signed_off` with final_answer "HALCYON SEVEN", the spine is wired correctly.
import "./_env";
import sharp from "sharp";

// Belt-and-suspenders: ensure the loop runs fully mocked even if .env.local
// hasn't flipped these. Set BEFORE importing any module that reads env at load.
process.env.MOCK_AI = process.env.MOCK_AI ?? "true";
process.env.MOCK_PHOTON = process.env.MOCK_PHOTON ?? "true";

// ── spectrum-ts load shim (simulator-only) ────────────────────────────────
// The loop statically imports photon.ts, which `import`s the ESM-only
// `spectrum-ts` SDK. Under tsx/Node 22 that SDK trips an ERR_REQUIRE_CYCLE_MODULE
// when pulled into a standalone CJS script's graph (it never even runs — it
// just fails to LOAD). With MOCK_PHOTON=true the SDK is never invoked, so we
// swap in a tiny load-time stub here, before importing the loop, keeping the
// whole graph in tsx's CJS mode. This is a SIMULATOR concern only; the Next dev
// server bundles the same code as proper ESM and is unaffected.
// (Internal `require` use in a script entry — never ships to the app.)
type ModuleLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional CJS hook to stub the ESM-only SDK at load time (simulator entry only)
const _mod = require("node:module") as { _load: ModuleLoad };
const _origLoad: ModuleLoad = _mod._load;
const _spectrumStub = {
  Spectrum: async () => ({ __mockSpectrumApp: true }),
  Emoji: {
    love: "love",
    like: "like",
    laugh: "laugh",
    emphasize: "emphasize",
    question: "question",
    dislike: "dislike",
  },
  imessage: Object.assign(() => ({}), { config: () => ({}) }),
};
_mod._load = function (this: unknown, request: string): unknown {
  if (request === "spectrum-ts" || request.startsWith("spectrum-ts/")) return _spectrumStub;
  // eslint-disable-next-line prefer-rest-params
  return _origLoad.apply(this, arguments as unknown as Parameters<ModuleLoad>);
};

// Types are erased at compile time, so importing them statically is safe (no
// runtime require of the SDK graph). The runtime modules (loop/memory/content)
// are loaded DYNAMICALLY inside main(), strictly AFTER the shim above is in
// place, so photon.ts resolves the stub instead of the real ESM SDK.
import type { InboundMessage, TurnResult } from "../src/lib/types";

// Lazily-populated runtime bindings (assigned in main() after the dynamic load).
type LoopMod = typeof import("../src/lib/loop");
type MemoryMod = typeof import("../src/lib/memory");
type ContentMod = typeof import("../src/lib/content");
let handleInbound!: LoopMod["handleInbound"];
let startSession!: LoopMod["startSession"];
let readPlayerMemory!: MemoryMod["readPlayerMemory"];
let CANON!: ContentMod["CANON"];

async function loadRuntime(): Promise<void> {
  const [loop, memory, content] = await Promise.all([
    import("../src/lib/loop"),
    import("../src/lib/memory"),
    import("../src/lib/content"),
  ]);
  handleInbound = loop.handleInbound;
  startSession = loop.startSession;
  readPlayerMemory = memory.readPlayerMemory;
  CANON = content.CANON;
}

// Renders a REAL (valid) "sponsor banner" JPEG as a data URL — stands in for the
// proof photo of the drop site. With MOCK_AI=false this exercises the genuine
// vision path; with MOCK_AI=true the bytes are simply never decoded.
async function makeBannerDataUrl(): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="520">
    <rect width="900" height="520" fill="#0b1020"/>
    <rect x="40" y="40" width="820" height="440" fill="#101a36" stroke="#3b82f6" stroke-width="8"/>
    <circle cx="180" cy="180" r="60" fill="#3b82f6"/>
    <text x="500" y="210" font-family="Arial" font-size="96" fill="#ffffff" text-anchor="middle" font-weight="bold">ROCKETRIDE</text>
    <text x="500" y="320" font-family="Arial" font-size="42" fill="#9ca3af" text-anchor="middle">Agentic AI · SF Hackathon</text>
  </svg>`;
  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

const PHONE = `+1555${Date.now().toString().slice(-7)}`;
const HANDLE = "GHOST";
const CHANNEL = "imessage" as const;

function inbound(partial: Partial<InboundMessage> & Pick<InboundMessage, "kind">): InboundMessage {
  return {
    source: "simulator",
    channel: CHANNEL,
    photonMessageId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fromPhone: PHONE,
    handlerLine: process.env.PHOTON_HANDLER_LINE ?? "+16282647656",
    receivedAt: new Date().toISOString(),
    ...partial,
  };
}

const HR = "─".repeat(72);

function printTurn(label: string, sent: string, turn: TurnResult): void {
  console.log(`\n${HR}`);
  console.log(`▶ ${label}`);
  console.log(`  operative ─→ ${sent || "(photo)"}`);
  console.log(`  beat       : ${turn.stateBefore}  ─→  ${turn.stateAfter}`);
  console.log(`  classify   : ${turn.classification}`);
  if (turn.verdict) {
    console.log(
      `  verdict    : ok=${turn.verdict.ok} conf=${turn.verdict.confidence} — ${turn.verdict.note}`,
    );
    if (turn.verdict.visionDescription)
      console.log(`  vision     : ${turn.verdict.visionDescription}`);
  }
  console.log(`  facts +    : ${turn.factsWritten}${turn.reconciled ? "  (RECONCILED)" : ""}`);
  console.log(`  HANDLER ←─ ${turn.reply.text}`);
  if (turn.reply.reactions?.length) console.log(`  tapbacks   : ${turn.reply.reactions.join(", ")}`);
}

async function feed(label: string, msg: InboundMessage): Promise<TurnResult> {
  const sentText = msg.text ?? "";
  const { turn } = await handleInbound(msg);
  printTurn(label, sentText, turn);
  return turn;
}

async function dumpMemory(playerId: string): Promise<void> {
  const mem = await readPlayerMemory(playerId);
  console.log(`\n${HR}`);
  console.log("SCOPED MEMORY (current facts the Handler can recall)");
  console.log("  WORLD:");
  for (const f of mem.world) console.log(`    • ${f.content}`);
  console.log("  PLAYER:");
  for (const f of mem.player) console.log(`    • ${f.content}`);
}

async function main(): Promise<void> {
  // Load the engine modules now (after the spectrum-ts shim is installed).
  await loadRuntime();

  console.log(`${HR}\nDEAD DROP — end-to-end simulation`);
  console.log(`  MOCK_AI=${process.env.MOCK_AI}  MOCK_PHOTON=${process.env.MOCK_PHOTON}`);
  console.log(`  player phone=${PHONE} handle=${HANDLE}`);

  // 0) Explicit start (auto-start would also fire on the first inbound, but this
  //    mirrors the dashboard "Start Session" + opening-call entrypoint).
  const { player, session, state } = await startSession(PHONE, HANDLE);
  console.log(`\n  session=${session.id}  player=${player.id}  beat=${state.beat}`);

  // 1) intro → cache_recovered : proof-of-presence photo of the banner.
  const bannerDataUrl = await makeBannerDataUrl();
  await feed("1. Proof photo of the drop site", inbound({ kind: "image", imageDataUrl: bannerDataUrl }));

  // 2) cache_recovered → contradiction : the operative reports in; intel breaks,
  //    the "clean courier" belief is reconciled, the fragment is awarded.
  await feed(
    "2. Operative reports in",
    inbound({ kind: "text", text: "Cache recovered. Heading to meet Mara at Pier 7." }),
  );

  // 3) contradiction → finale_identify : Handler has asked the finale question;
  //    the operative's reply moves us to identification.
  await feed(
    "3. Operative acknowledges the twist",
    inbound({ kind: "text", text: "Understood — she's burned. What now?" }),
  );

  // 4) finale_identify → solve : whatever they say is the wearing description.
  const wearingTurn = await feed(
    "4. Operative describes what they're wearing",
    inbound({ kind: "text", text: "Black leather jacket, white shirt, standing by the window." }),
  );

  // 5) solve → signed_off : the full passphrase signs them off.
  const finalTurn = await feed(
    "5. Operative gives the passphrase",
    inbound({ kind: "text", text: `${CANON.fragment} ${CANON.envelopeHalf}` }),
  );

  // Show the resulting scoped memory (the dashboard's three columns, in text).
  await dumpMemory(player.id);

  // ---- Assertions: the arc must have landed correctly. ----
  console.log(`\n${HR}\nRESULT`);
  const ok =
    wearingTurn.stateAfter === "solve" &&
    finalTurn.stateAfter === "signed_off";

  const checks: [string, boolean][] = [
    ["reached solve after wearing description", wearingTurn.stateAfter === "solve"],
    ["reached signed_off after passphrase", finalTurn.stateAfter === "signed_off"],
    ["final passphrase is HALCYON SEVEN", finalTurn.reply.beat === "signed_off"],
  ];
  for (const [name, pass] of checks) console.log(`  ${pass ? "✅" : "❌"} ${name}`);

  if (ok) {
    console.log(`\n✅ FULL ARC OK — the Handler reached HALCYON SEVEN and signed off.`);
    process.exit(0);
  } else {
    console.error(`\n❌ ARC INCOMPLETE — see the beat transitions above.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n❌ SIMULATE FAIL\n", e);
  process.exit(1);
});
