import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Lock, Crown } from "lucide-react";
import { api } from "../app/api";
import { C, UI } from "../theme";
import type { Entitlements } from "./client";

const BRAND = "linear-gradient(135deg,#FBC02D,#F7931A 55%,#7CC04E)";

export const PLAN_PRICE: Record<string, number> = { basic: 10, middle: 29.99, pro: 99.99 };
export const PLAN_LABEL: Record<string, string> = { basic: "Basic", middle: "Middle", pro: "Pro" };

/** Minimum plan that includes a given feature (for upgrade prompts/price tags). */
export const FEATURE_REQUIRES: Record<string, "basic" | "middle" | "pro"> = {
  backtest: "middle",
  daily_scan_1000: "middle",
  strategy_lab: "middle",
  full_scan: "pro",
  profit_engine: "pro",
};

/** Shared entitlements query — cached, used by gates across the app. */
export function useEntitlements() {
  return useQuery<Entitlements>({
    queryKey: ["entitlements"],
    queryFn: () => api.entitlements(),
    staleTime: 60_000,
    refetchInterval: 60 * 60_000,            // re-check the tester score hourly
    // Pause the hourly re-check while the tab is hidden (battery/data); it resumes
    // when the user returns to the tab.
    refetchIntervalInBackground: false,
  });
}

/** True if the current user's plan includes a named feature. */
export function useFeature(feature: string): boolean {
  const { data } = useEntitlements();
  return !!data && (data.isAdmin || data.features.includes(feature));
}

/** Gate state for a feature: allowed?, the plan needed, and its price. */
export function useGate(feature: string): { allowed: boolean; loading: boolean; requiredPlan: string; price: number } {
  const { data, isLoading } = useEntitlements();
  const requiredPlan = FEATURE_REQUIRES[feature] || "pro";
  const allowed = !!data && (data.isAdmin || data.features.includes(feature));
  return { allowed, loading: isLoading, requiredPlan, price: PLAN_PRICE[requiredPlan] ?? 0 };
}

function money(n: number) { return "$" + (n % 1 ? n.toFixed(2) : n.toFixed(0)); }

/**
 * Wraps gated content. If the user lacks `feature`, renders an upgrade prompt
 * (with the price + a link to the payment page) instead of the children.
 */
export function Gate({ feature, children, fallback }: {
  feature: string; children: React.ReactNode; fallback?: React.ReactNode;
}) {
  const { allowed, loading, requiredPlan, price } = useGate(feature);
  if (loading) return <>{children}</>;
  if (allowed) return <>{children}</>;
  return <>{fallback ?? <UpgradeCard requiredPlan={requiredPlan} price={price} />}</>;
}

/** A small inline "upgrade to unlock" card with a price tag + payment link. */
export function UpgradeCard({ title, note, requiredPlan = "pro", price }: {
  title?: string; note?: string; requiredPlan?: string; price?: number;
}) {
  const nav = useNavigate();
  const p = price ?? PLAN_PRICE[requiredPlan] ?? 0;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12,
      background: "rgba(247,147,26,0.07)", border: `1px solid #F7931A33`, fontFamily: UI,
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "#F7931A22", flexShrink: 0 }}>
        <Lock size={18} color={C.gold} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>
          {title || `${PLAN_LABEL[requiredPlan] || "Pro"} feature`}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
          {note || `Unlock from ${money(p)}/mo`}
        </div>
      </div>
      <button onClick={() => nav("/plans")} style={{
        display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
        background: "var(--btn-bg)", color: "var(--btn-ink)", fontWeight: 800, fontSize: 12.5, borderRadius: 9, padding: "8px 14px", fontFamily: UI, whiteSpace: "nowrap",
      }}>
        <Crown size={14} /> Upgrade
      </button>
    </div>
  );
}

/** Standalone à-la-carte price per feature — shown crossed-out on the home orbs
 * as a "deal" anchor that leads into buying a plan (where it's included). */
export const ALACARTE_PRICE: Record<string, number> = {
  backtest: 100,
  strategy_lab: 50,
  profit_engine: 500,
  daily_scan_1000: 100,
  full_scan: 100,
};

/** A price-tag chip to overlay on a locked control/orb. Shows the expensive
 * standalone price struck through in red (the plan deal). Click → payment page. */
export function PriceTag({ requiredPlan = "pro", price, crossPrice, onClick }: {
  requiredPlan?: string; price?: number; crossPrice?: number; onClick?: () => void;
}) {
  const nav = useNavigate();
  const anchor = crossPrice ?? price ?? PLAN_PRICE[requiredPlan] ?? 0;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); (onClick || (() => nav("/plans")))(); }}
      title={`${money(anchor)} on its own — included in the ${PLAN_LABEL[requiredPlan] || "Pro"} plan`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800,
        letterSpacing: "0.02em", color: "#fff", background: "rgba(11,6,19,0.92)",
        border: "1px solid rgba(247,147,26,0.55)",
        borderRadius: 999, padding: "3px 8px", fontFamily: UI, cursor: "pointer",
        boxShadow: "0 2px 8px -2px rgba(0,0,0,.6)",
      }}>
      <Lock size={9} color="#F7931A" />
      <span style={{ color: "#ff5b6b", textDecoration: "line-through", textDecorationColor: "#ff5b6b" }}>{money(anchor)}</span>
      <span style={{ color: "#FBC02D" }}>{" "}deal</span>
    </button>
  );
}

/** A tiny "PRO" / lock chip to overlay on gated controls. */
export function LockBadge({ label = "PRO" }: { label?: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, fontWeight: 800,
      letterSpacing: "0.06em", color: "var(--btn-ink)", background: "var(--btn-bg)",
      borderRadius: 999, padding: "2px 7px", fontFamily: UI,
    }}>
      <Lock size={9} /> {label}
    </span>
  );
}
