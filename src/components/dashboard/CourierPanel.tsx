"use client";

// FIELD COURIER — the RentAHuman "how it scales" panel.
//
// The planted teammate who hands off the envelope becomes a REAL stranger hired
// on demand. This card surfaces our open envelope-handoff bounty and the humans
// applying to it, live, on the projector.
//
//   • No bounty yet → a clear control: POST HANDOFF BOUNTY ($5) + a dry-run
//     preview toggle. Live-vs-dry is made obvious (a real post creates a public
//     listing that can summon a real person).
//   • Bounty exists → title, $price, status, a link to the listing, and a LIVE
//     list/count of applications as humans apply.
//
// Polls our own GET /api/rentahuman/status every ~5s (interval cleared on
// unmount). The RentAHuman key never reaches the browser — everything flows
// through our server routes.

import { useCallback, useEffect, useRef, useState } from "react";
import { PanelToggle } from "./PanelToggle";

const ACCENT = "#a78bfa"; // violet — distinct from world/player/handler scopes
const GLOW = "rgba(167,139,250,0.16)";
const DIM = "rgba(167,139,250,0.32)";

// --- shapes returned by /api/rentahuman/status (mirrors _store.ts) -----------
interface CourierBounty {
  id: string;
  title: string;
  price: number | null;
  priceType: string | null;
  status: string;
  url: string;
  depositUrl: string | null;
  applicationCount: number;
  spotsRemaining: number | null;
  createdAt: string | null;
}
interface CourierApplication {
  id: string;
  name: string;
  status: string | null;
  message: string | null;
  appliedAt: string | null;
}
interface CourierStatus {
  posted: boolean;
  bounty?: CourierBounty;
  applications?: CourierApplication[];
}

type PostResult = {
  ok: boolean;
  dryRun: boolean;
  bounty?: { id?: string; title?: string; price?: number; status?: string; url?: string } | null;
  url?: string | null;
  error?: string | null;
};

const POLL_MS = 5000;

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("active") || s.includes("open") || s.includes("filled")) return "#34d399";
  if (s.includes("pending") || s.includes("deposit") || s.includes("review")) return "#fbbf24";
  if (s.includes("closed") || s.includes("cancel") || s.includes("expired")) return "#9ca3af";
  return ACCENT;
}

function timeOf(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" });
}

export interface CourierPanelProps {
  /** When true, only the header (with live status) is shown. */
  collapsed?: boolean;
  /** Toggle collapsed/expanded. */
  onToggleCollapse?: () => void;
}

export function CourierPanel({ collapsed = false, onToggleCollapse }: CourierPanelProps = {}) {
  const [data, setData] = useState<CourierStatus | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Holds a dry-run preview without persisting it as a live listing.
  const [preview, setPreview] = useState<PostResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/rentahuman/status", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as CourierStatus;
      setData(json);
    } catch {
      /* offline / route not up yet — keep last known state */
    }
  }, []);

  // Poll every ~5s; clear on unmount.
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) void refresh();
    };
    run();
    const id = window.setInterval(run, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refresh]);

  const note = useCallback((kind: "ok" | "err", text: string) => {
    setFlash({ kind, text });
    window.setTimeout(() => setFlash(null), 5000);
  }, []);

  const post = useCallback(async () => {
    const live = !dryRun;
    if (live) {
      const ok = window.confirm(
        "POST A REAL public bounty on RentAHuman?\n\nThis creates a public listing and can summon a real person to the venue. (It's still $0 until you accept someone.)\n\nOK = post for real · Cancel = stay safe",
      );
      if (!ok) return;
    }
    setBusy(true);
    setPreview(null);
    try {
      const res = await fetch("/api/rentahuman/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const json = (await res.json().catch(() => null)) as PostResult | null;
      if (json?.ok) {
        if (json.dryRun) {
          setPreview(json);
          note("ok", "Dry-run preview ready — nothing posted, no charge.");
        } else {
          note("ok", "Bounty posted live — watching for applicants…");
          await refresh();
        }
      } else {
        note("err", json?.error ? `Post failed: ${json.error}` : "Post failed.");
      }
    } catch (err) {
      note("err", `Post failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [dryRun, note, refresh]);

  const bounty = data?.posted ? data.bounty : undefined;
  const applications = data?.applications ?? [];
  const appCount = bounty?.applicationCount ?? applications.length;

  return (
    <section
      className="rounded-lg p-3 flex flex-col gap-3"
      style={{ background: "rgba(8,10,14,0.85)", border: `1px solid ${DIM}` }}
      aria-label="Field courier — RentAHuman handoff bounty"
    >
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[11px] sm:text-xs font-black tracking-[0.28em] uppercase" style={{ color: ACCENT }}>
            ◇ Field Courier · RentAHuman
          </h2>
          <p className="text-[10px] uppercase tracking-[0.14em] text-white/35">
            recruit a real human to hand off the envelope
          </p>
        </div>
        <div className="flex items-center gap-2">
          {bounty ? (
            <span
              className="text-[10px] font-mono uppercase tracking-[0.14em] px-2 py-0.5 rounded"
              style={{ color: statusColor(bounty.status), border: `1px solid ${statusColor(bounty.status)}66` }}
              title="bounty status"
            >
              {bounty.status}
            </span>
          ) : (
            <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-white/30">no listing</span>
          )}
          {onToggleCollapse ? (
            <PanelToggle collapsed={collapsed} onToggle={onToggleCollapse} accent={ACCENT} label="Field Courier" />
          ) : null}
        </div>
      </div>

      {collapsed ? null : bounty ? (
        // ── LIVE LISTING ─────────────────────────────────────────────
        <>
          <div className="flex items-start justify-between gap-3">
            <a
              href={bounty.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] leading-snug font-semibold text-white/90 hover:text-white underline decoration-white/20 hover:decoration-white/60 underline-offset-2"
              title="open the public bounty listing"
            >
              {bounty.title}
            </a>
            <span
              className="shrink-0 font-black tabular-nums"
              style={{ color: ACCENT, fontSize: "1.35rem", textShadow: `0 0 18px ${GLOW}` }}
            >
              {bounty.price != null ? `$${bounty.price}` : "—"}
            </span>
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.14em] text-white/40">
            <span>
              {appCount} applicant{appCount === 1 ? "" : "s"}
              {bounty.spotsRemaining != null ? ` · ${bounty.spotsRemaining} spot${bounty.spotsRemaining === 1 ? "" : "s"} left` : ""}
            </span>
            <a
              href={bounty.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white/80"
              style={{ color: ACCENT }}
            >
              view listing ↗
            </a>
          </div>

          {/* live applications */}
          <div
            className="rounded-md overflow-hidden"
            style={{ border: `1px solid ${DIM}`, background: "rgba(167,139,250,0.05)" }}
          >
            <div
              className="px-2.5 py-1.5 flex items-center justify-between"
              style={{ borderBottom: `1px solid ${DIM}` }}
            >
              <span className="text-[10px] font-black tracking-[0.18em] uppercase" style={{ color: ACCENT }}>
                Applications
              </span>
              <span className="flex items-center gap-1.5 text-[10px] font-mono text-white/40">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: ACCENT, boxShadow: `0 0 6px ${ACCENT}` }}
                  aria-hidden
                />
                live · {appCount}
              </span>
            </div>
            <ul className="max-h-[148px] overflow-y-auto p-1.5 space-y-1.5">
              {applications.length === 0 ? (
                <li className="text-[11px] text-white/30 font-mono px-1.5 py-3 text-center">
                  waiting for a real courier to apply…
                </li>
              ) : (
                applications.map((a) => (
                  <li
                    key={a.id}
                    className="rounded px-2 py-1.5"
                    style={{ background: "rgba(255,255,255,0.04)", borderLeft: `2px solid ${ACCENT}` }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold text-white/90 truncate">{a.name}</span>
                      <span className="text-[9px] font-mono tabular-nums text-white/30 shrink-0">
                        {a.status ? a.status : timeOf(a.appliedAt)}
                      </span>
                    </div>
                    {a.message ? (
                      <p className="mt-0.5 text-[11px] leading-snug text-white/55 line-clamp-2">{a.message}</p>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      ) : (
        // ── NO LISTING YET — POST CONTROL ────────────────────────────
        <>
          <p className="text-[11px] leading-snug text-white/45 font-mono">
            Post the envelope-handoff bounty to summon a real field courier on demand.
            Posting is free; a price is only escrowed when you accept someone.
          </p>

          <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] font-mono cursor-pointer select-none"
            style={{ color: dryRun ? "#fbbf24" : "#34d399" }}
          >
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="accent-violet-400 w-3.5 h-3.5"
            />
            {dryRun ? "dry-run preview (safe — nothing posted)" : "LIVE — creates a REAL public listing"}
          </label>

          <button
            type="button"
            onClick={post}
            disabled={busy}
            className="px-4 py-2.5 rounded-md text-sm font-black tracking-wide uppercase transition disabled:opacity-40 disabled:cursor-not-allowed"
            style={
              dryRun
                ? { background: "rgba(167,139,250,0.14)", color: ACCENT, border: `1px solid ${DIM}` }
                : { background: "#22c55e", color: "#04140a", border: "1px solid transparent" }
            }
          >
            {busy
              ? dryRun
                ? "Previewing…"
                : "Posting…"
              : dryRun
                ? "Preview Handoff Bounty ($5)"
                : "▶ Post Handoff Bounty ($5) — LIVE"}
          </button>

          {/* dry-run preview output */}
          {preview?.bounty ? (
            <div
              className="rounded-md px-2.5 py-2"
              style={{ border: `1px solid ${DIM}`, background: "rgba(167,139,250,0.05)" }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black tracking-[0.16em] uppercase" style={{ color: "#fbbf24" }}>
                  Dry-run preview · not posted
                </span>
                {preview.url ? (
                  <a
                    href={preview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono hover:text-white/80"
                    style={{ color: ACCENT }}
                  >
                    sample url ↗
                  </a>
                ) : null}
              </div>
              <p className="text-[12px] leading-snug text-white/80">{preview.bounty.title}</p>
              <p className="text-[11px] font-mono text-white/45 mt-0.5">
                ${preview.bounty.price ?? 5} · {preview.bounty.status ?? "preview"} · uncheck dry-run to post for real
              </p>
            </div>
          ) : null}
        </>
      )}

      {/* flash */}
      {flash ? (
        <span
          className="text-[11px] font-mono px-2.5 py-1 rounded"
          style={{
            color: flash.kind === "ok" ? "#34d399" : "#fb7185",
            background: flash.kind === "ok" ? "rgba(52,211,153,0.1)" : "rgba(244,63,94,0.1)",
            border: `1px solid ${flash.kind === "ok" ? "rgba(52,211,153,0.3)" : "rgba(244,63,94,0.3)"}`,
          }}
        >
          {flash.text}
        </span>
      ) : null}
    </section>
  );
}
