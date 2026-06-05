"use client";

// When a belief gets rewritten (op supersede/reconcile), this banner pulses the
// headline event so the audience catches the moment a player's reality changes.
// Shows the most recent reconciliation; fades to a subtle log of prior ones.

import type { Scope } from "@/lib/types";
import type { ReconcileEvent } from "./useDashboardState";
import { SCOPE_THEMES } from "./FactColumn";

function scopeLabel(scope: Scope): string {
  return SCOPE_THEMES[scope]?.label ?? scope.toUpperCase();
}

export interface ReconcileBannerProps {
  reconciliations: ReconcileEvent[];
}

export function ReconcileBanner({ reconciliations }: ReconcileBannerProps) {
  if (reconciliations.length === 0) return null;
  const [latest, ...prior] = reconciliations;
  const theme = SCOPE_THEMES[latest.scope];

  return (
    <div
      className="rounded-lg px-4 py-2.5 flex items-center gap-3"
      style={{
        background: `linear-gradient(90deg, ${theme.glow}, rgba(8,10,14,0.6))`,
        border: `1px solid ${theme.dim}`,
        boxShadow: `0 0 24px ${theme.glow}`,
      }}
      role="status"
    >
      <span
        className="text-[10px] font-black tracking-[0.24em] uppercase whitespace-nowrap px-2 py-1 rounded"
        style={{ color: theme.accent, border: `1px solid ${theme.dim}` }}
      >
        ⟳ Reconciled · {scopeLabel(latest.scope)}
      </span>
      <p className="text-[13px] font-mono text-white/90 truncate">
        belief rewritten →{" "}
        <strong style={{ color: theme.accent }}>{latest.newContent || latest.note || "updated"}</strong>
      </p>
      {prior.length > 0 ? (
        <span className="ml-auto text-[10px] font-mono text-white/30 whitespace-nowrap">
          +{prior.length} earlier
        </span>
      ) : null}
    </div>
  );
}
