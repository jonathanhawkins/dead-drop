// Centralized, typed environment access (SERVER ONLY).
// Do not import this into client components — it reads server-only secrets.
// Client surfaces (dashboard, capture) read NEXT_PUBLIC_* vars directly.

function opt(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function bool(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

export const env = {
  port: Number(opt("PORT", "4317")),
  publicBaseUrl: opt("PUBLIC_BASE_URL"),

  butterbase: {
    appId: opt("BUTTERBASE_APP_ID", "app_tfaoy765u8au"),
    apiUrl: opt("BUTTERBASE_API_URL", "https://api.butterbase.ai/v1/app_tfaoy765u8au"),
    apiBase: opt("BUTTERBASE_API_BASE", "https://api.butterbase.ai"),
    serviceKey: opt("BUTTERBASE_SERVICE_KEY"),
  },

  ai: {
    model: opt("AI_MODEL", "anthropic/claude-sonnet-4.6"),
    visionModel: opt("AI_VISION_MODEL", "anthropic/claude-sonnet-4.6"),
    mock: bool("MOCK_AI", false),
  },

  photon: {
    projectId: opt("PHOTON_PROJECT_ID"),
    projectSecret: opt("PHOTON_PROJECT_SECRET"),
    apiBase: opt("PHOTON_API_BASE", "https://spectrum.photon.codes"),
    handlerLine: opt("PHOTON_HANDLER_LINE", "+16282647656"),
    channel: opt("PHOTON_CHANNEL", "imessage") as "imessage" | "whatsapp",
    webhookSigningSecret: opt("PHOTON_WEBHOOK_SIGNING_SECRET"),
    mock: bool("MOCK_PHOTON", false),
  },

  rocketride: {
    enabled: bool("USE_ROCKETRIDE", false),
    uri: opt("ROCKETRIDE_URI", "ws://localhost:5565"),
    apiKey: opt("ROCKETRIDE_APIKEY"),
  },

  voice: {
    provider: opt("VOICE_PROVIDER", "mock") as "mock" | "twilio" | "vapi" | "elevenlabs",
  },

  dashboard: {
    overrideToken: opt("DASHBOARD_OVERRIDE_TOKEN", "deaddrop-handler-override"),
  },
};

export type Env = typeof env;
