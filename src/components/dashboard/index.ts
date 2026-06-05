"use client";

// Barrel for the dashboard projector components. Keeps the page import tidy.
export { useDashboardState } from "./useDashboardState";
export type {
  DashboardState,
  DashboardFact,
  ReconcileEvent,
  TickerMessage,
  UseDashboardStateResult,
} from "./useDashboardState";
export { FactColumn, SCOPE_THEMES } from "./FactColumn";
export type { ScopeTheme, FactColumnProps } from "./FactColumn";
export { WearingPanel } from "./WearingPanel";
export { MessageTicker } from "./MessageTicker";
export { ControlBar } from "./ControlBar";
export { ReconcileBanner } from "./ReconcileBanner";
export { CourierPanel } from "./CourierPanel";
