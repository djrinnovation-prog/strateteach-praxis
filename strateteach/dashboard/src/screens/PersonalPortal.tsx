import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Settings, KeyRound, LifeBuoy, Crown, ShieldCheck, Mail, Activity, UserRound, Download } from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import FramedTitle from "../components/FramedTitle";
import { GlassTile, TileGrid, homeDim } from "../components/GlassTile";
import SquareRow from "../components/SquareRow";
import { centralExtras } from "../lib/centralExtras";
import ScreenShortcuts from "../components/ScreenShortcuts";
import ScreenBottom from "../components/ScreenBottom";
import { useViewMode, ViewToggle } from "../components/ViewToggle";
import TourLauncher from "../components/TourLauncher";
import { useIsMobile } from "../lib/useIsMobile";

// ── PERSONAL PORTAL parent ────────────────────────────────────────────────────
// Home's SECOND square opens this. LOCKED launcher (title + shortcuts + 2 central buttons
// + footer); extras open a CHILD screen via URL navigation (?sec=more) — never a modal.
export default function PersonalPortal() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  const mobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const sec = sp.get("sec") || "";
  const setSec = (v: string) => setSp(v ? { sec: v } : {});
  const [moreView, setMoreView] = useViewMode("algo770_personal_more_view_v1", "cards");

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: C.text,
      display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <TourLauncher screen="account" />

      {sec === "" && (
        <>
          <FramedTitle text={he ? "פורטל אישי" : "Personal Portal"}
            subtitle={he ? "הפרטים, ההגדרות והחיבורים שלך במקום אחד" : "Your details, settings and connections in one place"} />

          {/* Editable top shortcuts — the "עוד במערכת" chip opens the More CHILD (not a modal). */}
          <ScreenShortcuts
            screenKey="personal"
            defaultKeys={["help", "plans", "privacy", "activity"]}
            onMore={() => setSec("more")}
            catalog={[
              { key: "help", label: he ? "עזרה" : "Help", Icon: LifeBuoy, onClick: () => nav("/requests") },
              { key: "plans", label: he ? "מסלולים" : "Plans", Icon: Crown, onClick: () => nav("/plans") },
              { key: "privacy", label: he ? "פרטיות" : "Privacy", Icon: ShieldCheck, onClick: () => nav("/privacy") },
              { key: "messages", label: he ? "הודעות מהצוות" : "Team messages", Icon: Mail, onClick: () => nav("/team-messages") },
              { key: "activity", label: he ? "יומן פעילות" : "Activity", Icon: Activity, onClick: () => nav("/activity") },
            ]}
          />

          {/* 2 central glass buttons — now EDITABLE via SquareRow (choose which appear + order +
              APPROVE + reset). The screen's own 2 are shown by default; the shared app-destinations
              pool is addable from the ✎ editor. */}
          <SquareRow screenKey="personal-central" mobile={mobile} defaultShown={["account", "exchange"]}
            squares={[
              { id: "account", variant: "primary", Icon: Settings, label: he ? "פרטים והגדרות" : "Details & Settings", sub: he ? "פרופיל · הגדרות" : "Profile · settings", onClick: () => nav("/me") },
              { id: "exchange", variant: "secondary", Icon: KeyRound, label: he ? "חיבור בורסה" : "Exchange", sub: he ? "חבר · הפעל" : "Connect · enable", onClick: () => nav("/exchange?sec=connect") },
              ...centralExtras(he, nav, { exclude: ["account", "exchange"] }),
            ]} />
        </>
      )}

      {/* ── "עוד במערכת" CHILD — account tools as a tile grid with a rows/tiles toggle. ── */}
      {sec === "more" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FramedTitle text={he ? "עוד במערכת" : "More"} subtitle={he ? "כל אזורי החשבון" : "All account areas"} />
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "2px 2px 0" }}>
            <ViewToggle view={moreView} onChange={setMoreView} he={he} />
          </div>
          <TileGrid screenKey="personal-more" view={moreView} columns={3} aspect={1.08} tiles={[
            { id: "account", label: he ? "פרטים והגדרות" : "Details & Settings", Icon: Settings, onClick: () => nav("/me") },
            { id: "exchange", label: he ? "חיבור בורסה" : "Exchange", Icon: KeyRound, onClick: () => nav("/exchange?sec=connect") },
            { id: "plans", label: he ? "מסלולים" : "Plans", Icon: Crown, onClick: () => nav("/plans") },
            { id: "privacy", label: he ? "פרטיות" : "Privacy", Icon: ShieldCheck, onClick: () => nav("/privacy") },
            { id: "messages", label: he ? "הודעות מהצוות" : "Team messages", Icon: Mail, onClick: () => nav("/team-messages") },
            { id: "mydata", label: he ? "הנתונים שלי" : "My data", Icon: Download, onClick: () => nav("/me?sec=mydata") },
            { id: "help", label: he ? "עזרה" : "Help", Icon: LifeBuoy, onClick: () => nav("/requests") },
            { id: "activity", label: he ? "יומן פעילות" : "Activity", Icon: Activity, onClick: () => nav("/activity") },
            { id: "profile", label: he ? "פרופיל" : "Profile", Icon: UserRound, onClick: () => nav("/me") },
          ]} />
        </div>
      )}

      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
    </div>
  );
}
