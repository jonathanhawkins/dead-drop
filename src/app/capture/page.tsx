"use client";

// DEAD DROP — field capture page (the GPS / HTTPS backup proof path).
//
// Mobile-first. Runs in a secure context (HTTPS via the cloudflared tunnel) so
// geolocation + camera work. Flow:
//   1. player enters their phone number (the same one they texted the Handler);
//   2. we request a GPS fix (navigator.geolocation);
//   3. player takes/chooses a photo of the drop site (the sponsor banner);
//   4. POST /api/capture/upload-url -> presigned Butterbase storage URL;
//   5. PUT the file bytes to that URL (matching Content-Type);
//   6. POST /api/capture { phone, gps, photoObjectId } -> logs proof + drives loop;
//   7. show the cinematic "PRESENCE CONFIRMED" state (plus the Handler's reply).
//
// Every network call is wrapped; any failure drops us into a clear error with a
// retry, never a stuck spinner. Client component: reads NEXT_PUBLIC_* only.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Stage = "idle" | "locating" | "located" | "uploading" | "confirming" | "done" | "error";

interface Gps {
  lat: number;
  lng: number;
  accuracy?: number;
}

interface UploadUrlResponse {
  ok: boolean;
  uploadUrl?: string;
  objectId?: string;
  error?: string;
}

interface CaptureResponse {
  ok: boolean;
  eventId?: string;
  beat?: string;
  reply?: { text?: string; beat?: string };
  error?: string;
}

const PHONE_KEY = "deaddrop.capture.phone";

function loadStoredPhone(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PHONE_KEY) ?? "";
  } catch {
    return "";
  }
}

function geoErrorMessage(code: number): string {
  switch (code) {
    case 1:
      return "Location permission denied. Enable it in your browser settings and retry.";
    case 2:
      return "Position unavailable. Move to open sky and retry.";
    case 3:
      return "Location request timed out. Retry.";
    default:
      return "Could not acquire a position fix.";
  }
}

export default function CapturePage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [phone, setPhone] = useState<string>("");
  const [gps, setGps] = useState<Gps | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handlerReply, setHandlerReply] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Browser-only values must match the server on the FIRST render, then correct
  // after mount — otherwise React throws a hydration mismatch. `mounted` is false
  // on the server + first client render, true thereafter.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const stored = loadStoredPhone();
    if (stored) setPhone(stored);
  }, []);

  const secureContext = !mounted
    ? true
    : window.isSecureContext || window.location.hostname === "localhost";
  const geoSupported =
    !mounted || (typeof navigator !== "undefined" && "geolocation" in navigator);

  const phoneValid = useMemo(() => {
    const digits = phone.replace(/[^\d]/g, "");
    return digits.length >= 10;
  }, [phone]);

  const busy = stage === "locating" || stage === "uploading" || stage === "confirming";

  // ---- Step 2: geolocation ------------------------------------------------
  const acquireLocation = useCallback(() => {
    setError(null);
    if (!geoSupported) {
      setError("Geolocation is not available on this device/browser.");
      setStage("error");
      return;
    }
    setStage("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setStage("located");
      },
      (err) => {
        // GPS is a bonus on the backup path — let the player proceed without it.
        console.warn("[capture] geolocation failed:", err);
        setError(geoErrorMessage(err.code) + " You can still submit proof without GPS.");
        setStage("located");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }, [geoSupported]);

  // ---- Step 3: photo selection -------------------------------------------
  const onPhotoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0] ?? null;
    setPhoto(file);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }, []);

  // ---- Steps 4-6: upload + confirm ---------------------------------------
  const submit = useCallback(async () => {
    setError(null);
    const normalizedPhone = phone.trim();
    try {
      window.localStorage.setItem(PHONE_KEY, normalizedPhone);
    } catch {
      /* ignore storage failures */
    }

    let photoObjectId: string | undefined;

    // 4-5) Upload the photo if one was provided. A missing photo still counts as
    // an "I'm here" presence ping, so we don't hard-require it.
    if (photo) {
      setStage("uploading");
      const contentType = photo.type || "image/jpeg";
      const filename = photo.name || `proof-${Date.now()}.jpg`;
      try {
        const urlRes = await fetch("/api/capture/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, contentType, sizeBytes: photo.size }),
        });
        const urlData = (await urlRes.json()) as UploadUrlResponse;
        if (!urlData.ok || !urlData.uploadUrl || !urlData.objectId) {
          throw new Error(urlData.error || "no upload URL returned");
        }
        const putRes = await fetch(urlData.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: photo,
        });
        if (!putRes.ok) {
          throw new Error(`storage PUT failed (${putRes.status})`);
        }
        photoObjectId = urlData.objectId;
      } catch (err) {
        console.error("[capture] photo upload failed:", err);
        setError(
          "Photo upload failed. Submitting your position as proof instead — or retry the photo.",
        );
        // Fall through: we still confirm presence with GPS only.
      }
    }

    // 6) Confirm presence with the game loop.
    setStage("confirming");
    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: normalizedPhone,
          gps: gps ?? undefined,
          photoObjectId,
        }),
      });
      const data = (await res.json()) as CaptureResponse;
      if (!data.ok) {
        throw new Error(data.error || "capture rejected");
      }
      setHandlerReply(data.reply?.text ?? null);
      setStage("done");
    } catch (err) {
      console.error("[capture] /api/capture failed:", err);
      setError("Could not confirm presence. Check your connection and retry.");
      setStage("error");
    }
  }, [phone, photo, gps]);

  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
    setHandlerReply(null);
    setPhoto(null);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setGps(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ---- DONE: cinematic confirmation --------------------------------------
  if (stage === "done") {
    return (
      <main
        className="flex min-h-screen w-full flex-col items-center justify-center px-6 py-12 text-center font-mono"
        style={{ background: "#04070a", color: "#e6fbe6" }}
      >
        <div
          className="mb-8 flex h-24 w-24 items-center justify-center rounded-full border-2"
          style={{ borderColor: "#34d399", boxShadow: "0 0 40px rgba(52,211,153,0.45)" }}
        >
          <span style={{ fontSize: 44, lineHeight: 1, color: "#34d399" }}>✓</span>
        </div>
        <h1
          className="text-3xl font-bold tracking-[0.35em] sm:text-4xl"
          style={{ color: "#34d399", textShadow: "0 0 22px rgba(52,211,153,0.5)" }}
        >
          PRESENCE
          <br />
          CONFIRMED
        </h1>
        <p className="mt-5 max-w-xs text-sm leading-relaxed" style={{ color: "#7fdca0" }}>
          Your position has been logged. The Handler has your coordinates.
        </p>

        {gps ? (
          <p className="mt-3 text-xs tracking-widest" style={{ color: "#3f7a55" }}>
            {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
            {gps.accuracy != null ? ` · ±${Math.round(gps.accuracy)}m` : ""}
          </p>
        ) : null}

        {handlerReply ? (
          <div
            className="mt-8 w-full max-w-sm rounded-lg border px-5 py-4 text-left"
            style={{
              borderColor: "rgba(52,211,153,0.3)",
              background: "rgba(52,211,153,0.06)",
            }}
          >
            <div className="mb-1 text-[10px] tracking-[0.3em]" style={{ color: "#3f7a55" }}>
              INCOMING — THE HANDLER
            </div>
            <p className="text-sm leading-relaxed" style={{ color: "#cdeed7" }}>
              {handlerReply}
            </p>
          </div>
        ) : (
          <p className="mt-8 max-w-xs text-xs leading-relaxed" style={{ color: "#3f7a55" }}>
            Return to your messages. The Handler will reach you there.
          </p>
        )}

        <button
          type="button"
          onClick={reset}
          className="mt-10 rounded-md border px-5 py-2 text-xs tracking-[0.25em] transition-opacity hover:opacity-80"
          style={{ borderColor: "rgba(127,220,160,0.4)", color: "#7fdca0" }}
        >
          SUBMIT ANOTHER
        </button>
      </main>
    );
  }

  // ---- ACTIVE: capture flow ----------------------------------------------
  return (
    <main
      className="flex min-h-screen w-full flex-col px-6 py-10 font-mono"
      style={{ background: "#04070a", color: "#cfe3d6" }}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <header className="mb-8">
          <div className="text-[10px] tracking-[0.45em]" style={{ color: "#3f7a55" }}>
            DEAD DROP // FIELD UNIT
          </div>
          <h1
            className="mt-2 text-2xl font-bold tracking-[0.18em]"
            style={{ color: "#e6fbe6", textShadow: "0 0 18px rgba(52,211,153,0.25)" }}
          >
            PROOF OF PRESENCE
          </h1>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: "#6b8f78" }}>
            Backup channel. Confirm you are on-site at the drop. Capture the
            sponsor banner and lock your coordinates.
          </p>
        </header>

        {!secureContext ? (
          <Banner tone="warn">
            Not a secure context. Open this page over HTTPS (the tunnel URL) so the
            camera and GPS can be used.
          </Banner>
        ) : null}

        {error ? <Banner tone="warn">{error}</Banner> : null}

        {/* Step 1 — phone */}
        <Section index="01" label="OPERATIVE LINE">
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+1 555 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border px-4 py-3 text-base tracking-wider outline-none"
            style={{
              background: "#070d11",
              borderColor: phoneValid ? "rgba(52,211,153,0.5)" : "rgba(120,150,130,0.3)",
              color: "#e6fbe6",
            }}
          />
          <p className="mt-2 text-[11px]" style={{ color: "#5d7d69" }}>
            The number you used to contact the Handler.
          </p>
        </Section>

        {/* Step 2 — location */}
        <Section index="02" label="COORDINATES">
          {gps ? (
            <div
              className="rounded-md border px-4 py-3 text-sm tracking-wider"
              style={{ borderColor: "rgba(52,211,153,0.4)", background: "rgba(52,211,153,0.05)", color: "#9fe6b6" }}
            >
              LOCKED · {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
              {gps.accuracy != null ? ` · ±${Math.round(gps.accuracy)}m` : ""}
            </div>
          ) : (
            <button
              type="button"
              onClick={acquireLocation}
              disabled={busy || !geoSupported}
              className="w-full rounded-md border px-4 py-3 text-sm tracking-[0.2em] transition-opacity disabled:opacity-50"
              style={{ borderColor: "rgba(120,150,130,0.45)", color: "#cfe3d6" }}
            >
              {stage === "locating" ? "ACQUIRING FIX…" : "LOCK COORDINATES"}
            </button>
          )}
        </Section>

        {/* Step 3 — photo */}
        <Section index="03" label="VISUAL PROOF">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPhotoChange}
            disabled={busy}
            className="hidden"
            id="capture-photo-input"
          />
          <label
            htmlFor="capture-photo-input"
            className="block w-full cursor-pointer rounded-md border px-4 py-3 text-center text-sm tracking-[0.2em] transition-opacity"
            style={{
              borderColor: photo ? "rgba(52,211,153,0.5)" : "rgba(120,150,130,0.45)",
              color: photo ? "#9fe6b6" : "#cfe3d6",
              opacity: busy ? 0.5 : 1,
              pointerEvents: busy ? "none" : "auto",
            }}
          >
            {photo ? "RETAKE / REPLACE PHOTO" : "TAKE / CHOOSE PHOTO"}
          </label>

          {photoPreview ? (
            <div
              className="mt-3 overflow-hidden rounded-md border"
              style={{ borderColor: "rgba(52,211,153,0.3)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoPreview}
                alt="Captured proof preview"
                className="h-48 w-full object-cover"
              />
            </div>
          ) : (
            <p className="mt-2 text-[11px]" style={{ color: "#5d7d69" }}>
              Frame the sponsor banner at the drop site.
            </p>
          )}
        </Section>

        {/* Submit */}
        <div className="mt-auto pt-6">
          <button
            type="button"
            onClick={submit}
            disabled={busy || !phoneValid || (!photo && !gps)}
            className="w-full rounded-md px-6 py-4 text-base font-bold tracking-[0.3em] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: "#34d399",
              color: "#04140b",
              boxShadow: "0 0 30px rgba(52,211,153,0.35)",
            }}
          >
            {stage === "uploading"
              ? "UPLOADING…"
              : stage === "confirming"
                ? "CONFIRMING…"
                : "TRANSMIT PROOF"}
          </button>
          {!phoneValid ? (
            <p className="mt-3 text-center text-[11px]" style={{ color: "#5d7d69" }}>
              Enter your operative line to transmit.
            </p>
          ) : !photo && !gps ? (
            <p className="mt-3 text-center text-[11px]" style={{ color: "#5d7d69" }}>
              Lock coordinates or attach a photo first.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}

// ---- small presentational helpers (same file, no cross-role deps) ---------
function Section({
  index,
  label,
  children,
}: {
  index: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="text-[10px] tracking-[0.3em]"
          style={{ color: "#34d399" }}
        >
          {index}
        </span>
        <span className="text-[10px] tracking-[0.3em]" style={{ color: "#6b8f78" }}>
          {label}
        </span>
        <span className="h-px flex-1" style={{ background: "rgba(107,143,120,0.2)" }} />
      </div>
      {children}
    </section>
  );
}

function Banner({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  const warn = tone === "warn";
  return (
    <div
      className="mb-6 rounded-md border px-4 py-3 text-xs leading-relaxed"
      style={{
        borderColor: warn ? "rgba(245,158,11,0.5)" : "rgba(52,211,153,0.4)",
        background: warn ? "rgba(245,158,11,0.08)" : "rgba(52,211,153,0.06)",
        color: warn ? "#fcd9a0" : "#9fe6b6",
      }}
    >
      {children}
    </div>
  );
}
