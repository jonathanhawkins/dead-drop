// Renders the Handler's opening monologue to public/opener.mp3 so the Twilio
// opening call PLAYS a cinematic voice instead of Polly. voice.ts auto-detects
// the file — no restart needed after generating.
//
// Picks a TTS provider from whichever key is present (override with TTS_PROVIDER):
//   OPENAI_API_KEY      → OpenAI TTS (voice "onyx" by default)   [recommended]
//   ELEVENLABS_API_KEY  → ElevenLabs TTS (voice "Adam" by default)
//
//   npx tsx scripts/gen-opener.ts
import "./_env";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { OPENER_SCRIPT } from "../src/lib/voice";

async function genOpenAI(key: string): Promise<Buffer> {
  const voice = process.env.OPENAI_TTS_VOICE || "onyx"; // deep, authoritative
  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  console.log(`OpenAI TTS — model=${model} voice=${voice}`);
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      voice,
      input: OPENER_SCRIPT,
      response_format: "mp3",
      // gpt-4o-mini-tts honors a delivery instruction; older tts-1 models ignore it.
      instructions:
        "A terse, controlled, cinematic spymaster Handler on a secure line. Hushed and urgent, measured pace, real weight on the threats. Never warm.",
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function genElevenLabs(key: string): Promise<Buffer> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB"; // Adam
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5";
  console.log(`ElevenLabs TTS — voice=${voiceId} model=${modelId}`);
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: OPENER_SCRIPT,
        model_id: modelId,
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const openai = process.env.OPENAI_API_KEY;
  const eleven = process.env.ELEVENLABS_API_KEY;
  const provider = process.env.TTS_PROVIDER || (openai ? "openai" : eleven ? "elevenlabs" : "");
  if (!provider) {
    console.error("Set OPENAI_API_KEY (recommended) or ELEVENLABS_API_KEY in .env.local.");
    process.exit(1);
  }
  console.log(`Rendering opener via ${provider} (${OPENER_SCRIPT.length} chars)…`);

  const buf =
    provider === "openai"
      ? await genOpenAI(openai as string)
      : await genElevenLabs(eleven as string);

  mkdirSync(resolve(process.cwd(), "public"), { recursive: true });
  const out = resolve(process.cwd(), "public", "opener.mp3");
  writeFileSync(out, buf);
  console.log(`✅ Wrote ${out} (${(buf.length / 1024).toFixed(0)} KB) via ${provider}.`);
  console.log("The Twilio call will now PLAY this — re-run scripts/verify-voice.ts to hear it.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
