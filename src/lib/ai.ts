// AI gateway client (Butterbase, OpenAI-compatible) for the Handler's narration
// and for vision verification of proof photos. SERVER ONLY.
//
// Endpoint: {apiUrl}/chat/completions  (apiUrl already includes /v1/{app_id}).
// Image input: content parts with { type:"image_url", image_url:{ url } } where
// url is a base64 data URI or an HTTPS URL. Phone photos are often HEIC, which
// Claude does not accept — toJpegDataUrl() converts + shrinks them first.
import sharp from "sharp";
import convert from "heic-convert";
import { env } from "./env";

type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Part[];
}
export interface ChatOpts {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export async function chat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const res = await fetch(`${env.butterbase.apiUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.butterbase.serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? env.ai.model,
      messages,
      max_tokens: opts.maxTokens ?? 400,
      temperature: opts.temperature ?? 0.8,
    }),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/** Plain text completion (Handler narration). */
export async function complete(
  system: string,
  user: string,
  opts: ChatOpts = {},
): Promise<string> {
  if (env.ai.mock) return mockNarration(user);
  return chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    opts,
  );
}

/** Ask for JSON and parse it (classification, structured beats). Falls back gracefully. */
export async function completeJSON<T>(
  system: string,
  user: string,
  fallback: T,
  opts: ChatOpts = {},
): Promise<T> {
  if (env.ai.mock) return fallback;
  try {
    const raw = await chat(
      [
        { role: "system", content: system + "\nRespond with ONLY valid minified JSON." },
        { role: "user", content: user },
      ],
      { temperature: 0.2, ...opts },
    );
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export interface ImageInput {
  dataUrl?: string;
  bytes?: Buffer;
  mime?: string;
}

/** Describe an image with the vision model. Narrative, never a hard gate. */
export async function describeImage(prompt: string, image: ImageInput): Promise<string> {
  if (env.ai.mock) return mockVision();
  const url = image.dataUrl ?? (await toJpegDataUrl(image.bytes!, image.mime));
  return chat(
    [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url } },
        ],
      },
    ],
    { model: env.ai.visionModel, maxTokens: 300, temperature: 0.4 },
  );
}

/** Normalize any phone image (HEIC/JPEG/PNG) to a small JPEG data URL. */
export async function toJpegDataUrl(bytes: Buffer, mime?: string): Promise<string> {
  let input: Buffer = bytes;
  if (mime?.includes("heic") || mime?.includes("heif")) {
    const out = await convert({ buffer: bytes, format: "JPEG", quality: 0.85 });
    input = Buffer.from(out);
  }
  const jpeg = await sharp(input)
    .rotate() // honor EXIF orientation
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

// ---- Mocks (MOCK_AI=true) — keep the loop runnable without spending credits ----
function mockNarration(user: string): string {
  if (/wear|jacket|window|identify/i.test(user))
    return "Copy. I'll get my courier to you. Don't move.";
  if (/banner|photo|see|sector/i.test(user))
    return "Good — that's the right sector. The cache is close. Recover it.";
  return "Understood. Hold position and await the next signal.";
}
function mockVision(): string {
  return "A large high-contrast sponsor banner mounted on a stand, logo clearly visible, indoor event lighting.";
}
