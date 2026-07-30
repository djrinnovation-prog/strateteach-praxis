import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, BookOpen, ShieldAlert, Rocket, Layers, Info, Diamond, Play, BarChart3, FlaskConical, Pencil } from "lucide-react";
import { useI18n } from "../i18n";
import { C, SHADOW, UI } from "../theme";
import { STEPS, SECTIONS, GLOSSARY, type Lang, type Sec } from "../lib/uni";
import { api, isAdmin, isContentEditor } from "../app/api";
import type { UniItem, UniItemInput } from "../lib/client";
import { useSearchParams } from "react-router-dom";
import ScreenShortcuts from "../components/ScreenShortcuts";
import HomeTop from "../components/HomeTop";
import FramedTitle from "../components/FramedTitle";
import { GlassTile, TileGrid, homeDim } from "../components/GlassTile";
import SquareRow from "../components/SquareRow";
import { centralExtras } from "../lib/centralExtras";
import ScreenBottom from "../components/ScreenBottom";
import { useViewMode, ViewToggle } from "../components/ViewToggle";
import { HubPanel } from "../components/HubScreen";
import { useIsMobile } from "../lib/useIsMobile";
import AboutContent, { ABOUT_STR } from "../components/AboutContent";
import UniversityEditor, { UNI_ICONS } from "./UniversityEditor";

// built-in concept id → lucide key, for seeding the DB store from lib/uni.ts.
const SEC_ICON_KEY: Record<string, string> = {
  scanner: "Search", backtest: "FlaskConical", lab: "Wand2", profit: "TrendingUp",
  exchange: "ArrowLeftRight", telegram: "Send", activity: "Activity",
};
const splitParas = (s: string): string[] => (s || "").split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);

// ALGO770 University — a guided, plain-language explanation of the whole app. The
// content lives in lib/uni.ts so the floating Avatar helper reads the same material.
// Re-laid onto the app springboard: three FATHER tiles (Getting started · Concepts ·
// Glossary). Long reference lists scroll inside their child; the tiles stay put.
const T = {
  he: { title: "הסברים", sub: "מדריך מלא — מאפס להבנה מלאה של המערכת",
    startTitle: "צעדים ראשונים", conceptsTitle: "מושגי המערכת", glossaryTitle: "מילון מונחים",
    fStart: "צעדים ראשונים", fConcepts: "מושגים", fGlossary: "מילון", fAbout: "מי אנחנו",
    risk: "תזכורת סיכון: זהו כלי תוכנה, לא ייעוץ פיננסי. מסחר כרוך בסיכון לאובדן ההון. אתם מאשרים כל פקודה ואחראים לכל החלטה." },
  en: { title: "Explanations", sub: "The full guide — from zero to fully understanding the system",
    startTitle: "Getting started", conceptsTitle: "System concepts", glossaryTitle: "Glossary",
    fStart: "Getting started", fConcepts: "Concepts", fGlossary: "Glossary", fAbout: "About Us",
    risk: "Risk reminder: this is a software tool, not financial advice. Trading can lose your capital. You approve every order and own every decision." },
};

export default function University() {
  const { lang, rtl } = useI18n();
  const nav = useNavigate();
  const he = lang === "he";
  const mobile = useIsMobile();
  const tt = T[lang];
  const canEdit = isAdmin() || isContentEditor();
  const [editorOpen, setEditorOpen] = useState(false);
  const [sp, setSp] = useSearchParams();
  const sec = sp.get("sec") || "";
  const setSec = (v: string) => setSp(v ? { sec: v } : {});
  const [moreView, setMoreView] = useViewMode("algo770_university_more_view_v1", "cards");

  // Content source: the editable DB store when it has content, else the built-in
  // lib/uni.ts content (so the screen is never empty / nothing is ever lost).
  const uniQ = useQuery({ queryKey: ["universityContent"], queryFn: () => api.universityContent(), staleTime: 60000 });
  const has = !!uniQ.data?.hasContent;
  const secOf = (s: string): UniItem[] => (uniQ.data?.sections?.[s] || []);
  const steps: Record<Lang, string[]> = has
    ? { he: secOf("getting_started").map((i) => i.bodyHe), en: secOf("getting_started").map((i) => i.bodyEn) }
    : STEPS;
  const sections: Sec[] = has
    ? secOf("concepts").map((i) => ({ id: String(i.id), Icon: UNI_ICONS[i.icon] || Layers,
        title: { he: i.titleHe, en: i.titleEn }, body: { he: splitParas(i.bodyHe), en: splitParas(i.bodyEn) } }))
    : SECTIONS;
  const glossary = has
    ? secOf("glossary").map((i) => ({ term: { he: i.titleHe, en: i.titleEn }, def: { he: i.bodyHe, en: i.bodyEn } }))
    : GLOSSARY;

  // The built-in content, shaped for the editor's one-click "import" seed.
  const builtinItems: UniItemInput[] = [
    ...STEPS.he.map((_, i) => ({ section: "getting_started", title_he: "", title_en: "", body_he: STEPS.he[i] || "", body_en: STEPS.en[i] || "", position: i, published: true })),
    ...SECTIONS.map((s, i) => ({ section: "concepts", icon: SEC_ICON_KEY[s.id] || "Layers", title_he: s.title.he, title_en: s.title.en, body_he: s.body.he.join("\n\n"), body_en: s.body.en.join("\n\n"), position: i, published: true })),
    ...GLOSSARY.map((g, i) => ({ section: "glossary", title_he: g.term.he, title_en: g.term.en, body_he: g.def.he, body_en: g.def.en, position: i, published: true })),
  ];

  // "About Us / מי אנחנו" — the plain-language intro lives in the shared
  // AboutContent component so the Home wordmark modal renders the exact same text.
  const aboutView = () => <AboutContent />;

  const startView = () => (
    <>
      <div style={{ background: `${C.loss}1a`, border: `1px solid ${C.loss}59`, color: C.loss, borderRadius: 10, padding: "10px 13px", fontSize: 12.5, marginBottom: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
        <ShieldAlert size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {tt.risk}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {steps[lang].map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
            <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: "var(--btn-bg)", color: "var(--btn-ink)", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.55, paddingTop: 2 }}>{s}</span>
          </div>
        ))}
      </div>
    </>
  );

  const glossaryView = () => (
    // No inner max-height / scroll region (same reasoning as ConceptsView): the
    // grid grows to its FULL natural height and the page scrolls, so long glossary
    // entries are never clipped — including in large-text mode where the fixed
    // 70svh box would otherwise cut off the bottom rows.
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, paddingBottom: 6 }}>
      {glossary.map((g, i) => (
        <div key={i} style={{ border: `1px solid ${C.line}`, borderInlineStart: `3px solid ${C.gold}`,
          background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, borderRadius: 12,
          padding: "11px 13px 12px", boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), ${SHADOW}` }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{g.term[lang]}</div>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, marginTop: 2 }}>{g.def[lang]}</div>
        </div>
      ))}
    </div>
  );

  return (
    <>
    {canEdit && (
      <button onClick={() => setEditorOpen(true)} className="tap44"
        style={{ position: "fixed", insetInlineStart: 14, bottom: "calc(74px + env(safe-area-inset-bottom, 0px))", zIndex: 45,
          display: "inline-flex", alignItems: "center", gap: 7, background: C.accentGrad, color: "#0B0613",
          border: "none", borderRadius: 999, padding: "9px 14px", fontSize: 12.5, fontWeight: 800, cursor: "pointer",
          fontFamily: UI, boxShadow: "0 10px 26px -10px rgba(0,0,0,0.5)" }}>
        <Pencil size={14} /> {he ? "ערוך תוכן" : "Edit content"}
      </button>
    )}
    {editorOpen && <UniversityEditor onClose={() => setEditorOpen(false)} onChanged={() => uniQ.refetch()} builtin={builtinItems} he={he} rtl={he} />}
    <div style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: C.text, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>

      {sec === "" && (
        <>
          <FramedTitle text={tt.title} subtitle={tt.sub} />

          {/* Editable top shortcuts — the "עוד במערכת" chip opens the More CHILD (not a modal). */}
          <ScreenShortcuts
            screenKey="university"
            defaultKeys={["concepts", "glossary", "about", "lab", "perf"]}
            onMore={() => setSec("more")}
            catalog={[
              { key: "concepts", label: he ? "נושאים" : "Topics", Icon: Layers, onClick: () => setSec("concepts") },
              { key: "glossary", label: he ? "הסברים" : "Explanations", Icon: BookOpen, onClick: () => setSec("glossary") },
              { key: "about", label: he ? "מי אנחנו" : "About", Icon: Info, onClick: () => setSec("about") },
              { key: "lab", label: "Strategy Lab", Icon: FlaskConical, onClick: () => nav("/strategy") },
              { key: "perf", label: he ? "ביצועים" : "Performance", Icon: BarChart3, onClick: () => nav("/analytics") },
            ]}
          />

          {/* 3 central glass buttons — Home's exact SQUARES (centered), primary bigger. */}
          <SquareRow screenKey="university-central" mobile={mobile} defaultShown={["guides", "concepts", "glossary"]}
            squares={[
              { id: "guides", variant: "primary", Icon: Rocket, label: he ? "מדריכים" : "Guides", sub: he ? "צעדים ראשונים" : "getting started", onClick: () => setSec("start") },
              { id: "concepts", variant: "secondary", Icon: Layers, label: he ? "מושגים" : "Concepts", sub: he ? "מושגי המערכת" : "system concepts", onClick: () => setSec("concepts") },
              { id: "glossary", variant: "secondary", Icon: BookOpen, label: he ? "מילון" : "Glossary", sub: he ? "מונחים" : "terms", onClick: () => setSec("glossary") },
              ...centralExtras(he, nav, { exclude: ["learn"] }),
            ]} />
        </>
      )}

      {/* ── "עוד במערכת" CHILD — the learn areas as a tile grid with a rows/tiles toggle. ── */}
      {sec === "more" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FramedTitle text={he ? "עוד במערכת" : "More"} subtitle={he ? "כל אזורי הלמידה" : "All learn areas"} />
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "2px 2px 0" }}>
            <ViewToggle view={moreView} onChange={setMoreView} he={he} />
          </div>
          <TileGrid screenKey="university-more" view={moreView} columns={3} aspect={1.08} tiles={[
            { id: "start", label: he ? "מדריכים" : "Guides", Icon: Rocket, onClick: () => setSec("start") },
            { id: "concepts", label: he ? "מושגים" : "Concepts", Icon: Layers, onClick: () => setSec("concepts") },
            { id: "glossary", label: he ? "מילון" : "Glossary", Icon: BookOpen, onClick: () => setSec("glossary") },
            { id: "about", label: he ? "מי אנחנו" : "About", Icon: Info, onClick: () => setSec("about") },
            { id: "reels", label: he ? "רילים" : "Reels", Icon: Play, onClick: () => nav("/reels") },
            { id: "lab", label: "Strategy Lab", Icon: FlaskConical, onClick: () => nav("/strategy") },
          ]} />
        </div>
      )}

      {sec === "start" && (
        <HubPanel alwaysOpen ns="university" id="start" title={tt.startTitle} icon={<Rocket size={15} />} onClose={() => setSec("")}>
          <HomeTop />{startView()}
        </HubPanel>
      )}
      {sec === "concepts" && (
        <HubPanel alwaysOpen ns="university" id="concepts" title={tt.conceptsTitle} icon={<Layers size={15} />} onClose={() => setSec("")}>
          <ConceptsView sections={sections} />
        </HubPanel>
      )}
      {sec === "glossary" && (
        <HubPanel alwaysOpen ns="university" id="glossary" title={tt.glossaryTitle} icon={<BookOpen size={15} />} onClose={() => setSec("")}>
          {glossaryView()}
        </HubPanel>
      )}
      {sec === "about" && (
        <HubPanel alwaysOpen ns="university" id="about" title={ABOUT_STR[lang].aboutTitle} icon={<Info size={15} />} onClose={() => setSec("")}>
          {aboutView()}
        </HubPanel>
      )}

      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
    </div>
    </>
  );
}

// Concept sections accordion — its own component so the open-section state persists.
// `sections` comes from the editable store (or the built-in fallback) via the parent.
function ConceptsView({ sections }: { sections: Sec[] }) {
  const { lang, rtl } = useI18n();
  const [open, setOpen] = useState<string | null>(sections[0]?.id || null);
  return (
    // No inner max-height / scroll region: an expanded card grows to its FULL
    // natural content height and the whole page scrolls (like the sibling
    // Getting-started / About panels). A fixed 70svh inner scroller used to clip
    // the bottom lines of a long open card — worse in large-text mode, where the
    // header + tiles push this block down and the paragraphs grow taller.
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 6 }}>
      {sections.map((sec) => {
        const isOpen = open === sec.id;
        return (
          <div key={sec.id} style={{ background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
            border: `1.5px solid ${isOpen ? C.gold : C.line}`, borderRadius: 12, overflow: "hidden",
            boxShadow: isOpen ? `inset 0 1px 0 rgba(255,255,255,0.25), ${SHADOW}` : "inset 0 1px 0 rgba(255,255,255,0.18)" }}>
            <button onClick={() => setOpen(isOpen ? null : sec.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "none", border: "none", cursor: "pointer", padding: "14px 16px", color: C.text, textAlign: rtl ? "right" : "left" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 600 }}>
                <sec.Icon size={17} color={C.gold} /> {sec.title[lang]}
              </span>
              <ChevronDown size={17} color={C.muted} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            </button>
            {isOpen && (
              <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 9 }}>
                {sec.body[lang].map((p, i) => <p key={i} style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: C.muted }}>{p}</p>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
