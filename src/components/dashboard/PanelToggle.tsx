"use client";

// A small chevron button used to collapse/expand the right-rail panels
// (Field Actor, Field Courier, Live Wire) so the operator can fit everything on
// the projector. Pure presentation — collapse state is owned by the page.

export interface PanelToggleProps {
  collapsed: boolean;
  onToggle: () => void;
  /** Accent color for the chevron (matches the panel's header). */
  accent?: string;
  /** Human label for the panel, used in the aria-label. */
  label?: string;
}

export function PanelToggle({
  collapsed,
  onToggle,
  accent = "rgba(255,255,255,0.5)",
  label = "panel",
}: PanelToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
      title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded hover:bg-white/10 transition"
      style={{ color: accent }}
    >
      <span
        className="text-[11px] leading-none transition-transform duration-200"
        style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
        aria-hidden
      >
        ▾
      </span>
    </button>
  );
}
