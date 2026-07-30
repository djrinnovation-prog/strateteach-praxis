import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, ArrowDownUp, Check } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, MONO } from "../theme";

// Admin "manage how the bots work" screen — focused on the thing that actually
// gates shorts: the short-entry filters. Each saved strategy (e.g. BOT 5, built
// on the bot4 engine) can be switched between three short-aggressiveness presets,
// or have shorts turned off entirely. Applies via the existing saved-strategy
// update endpoint (no new backend), so it's safe and immediate.
//
// Presets map to the engine's real short-filter fields:
//   shortRegimeMode: "Off" | "Below SMA200" | "SMA200 Down"
//   shortUseAdxFilter / requireFilterDownForShort / requireDiBearishForShort
type PresetKey = "conservative" | "balanced" | "aggressive";

const PRESETS: Record<PresetKey, Record<string, unknown>> = {
  conservative: { enableShorts: true, shortRegimeMode: "SMA200 Down", shortUseAdxFilter: true, requireFilterDownForShort: true, requireDiBearishForShort: true },
  balanced:     { enableShorts: true, shortRegimeMode: "Below SMA200", shortUseAdxFilter: true, requireFilterDownForShort: true, requireDiBearishForShort: false },
  aggressive:   { enableShorts: true, shortRegimeMode: "Off",          shortUseAdxFilter: false, requireFilterDownForShort: false, requireDiBearishForShort: false },
};

function currentPreset(cfg: any): PresetKey | "off" | "custom" {
  if (!cfg || cfg.enableShorts === false) return "off";
  for (const k of Object.keys(PRESETS) as PresetKey[]) {
    const p = PRESETS[k];
    if (Object.entries(p).every(([f, v]) => (cfg as any)[f] === v)) return k;
  }
  return "custom";
}

export default function BotManager() {
  const { lang } = useI18n();
  const rtl = lang === "he";
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  const q = useQuery({ queryKey: ["savedStrategies"], queryFn: () => api.savedStrategies() });
  const strategies: any[] = (q.data as any[]) || [];

  const applyM = useMutation({
    mutationFn: (v: { id: number; cfg: any }) => api.updateSavedStrategy(v.id, { config: v.cfg }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["savedStrategies"] }); flash(lang === "he" ? "נשמר ✓" : "Saved ✓"); },
    onError: (e: any) => flash(e?.message || String(e)),
  });

  const T = (en: string, he: string) => (lang === "he" ? he : en);
  const PRESET_LABEL: Record<PresetKey, string> = {
    conservative: T("Conservative", "שמרני"),
    balanced: T("Balanced", "מאוזן"),
    aggressive: T("Aggressive", "אגרסיבי"),
  };
  const PRESET_NOTE: Record<PresetKey, string> = {
    conservative: T("Shorts only in a confirmed downtrend (SMA200 down + ADX + DI). Rarely fires in bull markets.", "שורט רק במגמת ירידה מאומתת (SMA200 יורד + ADX + DI). כמעט לא נכנס בשוק עולה."),
    balanced: T("Shorts below SMA200 with trend confirmation. Fires more often.", "שורט מתחת ל-SMA200 עם אישור מגמה. נכנס יותר."),
    aggressive: T("Shorts on any lower-band break (filters off). Fires readily — more trades, more risk.", "שורט בכל שבירת רצועה תחתונה (בלי פילטרים). נכנס בקלות — יותר עסקאות, יותר סיכון."),
  };

  return (
    <div style={{ fontFamily: UI, direction: rtl ? "rtl" : "ltr" }}>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
        {T("Control how each bot shorts. bot4 / bot8c / your saved bots already trade long+short — but shorts are filter-gated. Pick a preset to make shorts fire more or less often, or turn them off.",
           "שלוט באיך כל בוט עושה שורט. bot4 / bot8c / הבוטים השמורים שלך כבר סוחרים לונג+שורט — אבל השורט מסונן. בחר פריסט כדי שהשורט ייכנס יותר/פחות, או כבה אותו.")}
      </div>
      {msg && <div style={{ marginBottom: 10, background: `${C.gain}1f`, border: `1px solid ${C.gain}`, color: C.gain, borderRadius: 9, padding: "8px 11px", fontSize: 13, fontWeight: 700 }}>{msg}</div>}

      {q.isLoading ? <Loader2 className="spin" color={C.gold} />
        : strategies.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 13, padding: 12, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10 }}>
            {T("No saved bots yet. Save a strategy in Strategy Lab (e.g. BOT 5) and it will appear here.",
               "אין בוטים שמורים עדיין. שמור אסטרטגיה ב-Strategy Lab (למשל BOT 5) והיא תופיע כאן.")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {strategies.map((s) => {
              const cur = currentPreset(s.config);
              const busy = applyM.isPending;
              return (
                <div key={s.id} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10, flexWrap: "wrap" }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: `${C.gold}1f`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Bot size={16} color={C.gold} /></div>
                    <div style={{ fontWeight: 800, fontSize: 14.5, color: C.text }}>{s.name}</div>
                    <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 6, padding: "1px 7px" }}>{s.strategyId}</span>
                    <span style={{ marginInlineStart: "auto", fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 7,
                      color: cur === "off" ? C.muted : C.gain, border: `1px solid ${cur === "off" ? C.line : C.gain}` }}>
                      {cur === "off" ? T("shorts off", "שורט כבוי") : cur === "custom" ? T("custom shorts", "שורט מותאם") : T("shorts: ", "שורט: ") + PRESET_LABEL[cur as PresetKey]}
                    </span>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {(Object.keys(PRESETS) as PresetKey[]).map((k) => {
                      const active = cur === k;
                      return (
                        <button key={k} disabled={busy}
                          onClick={() => applyM.mutate({ id: s.id, cfg: { ...s.config, ...PRESETS[k] } })}
                          title={PRESET_NOTE[k]}
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: busy ? "wait" : "pointer", fontFamily: "inherit",
                            background: active ? "var(--btn-bg)" : C.surface2, color: active ? "var(--btn-ink)" : C.text,
                            border: `1px solid ${active ? C.gold : C.line}`, borderRadius: 9, padding: "8px 12px", fontSize: 12.5, fontWeight: 700 }}>
                          {active ? <Check size={13} /> : <ArrowDownUp size={13} />} {PRESET_LABEL[k]}
                        </button>
                      );
                    })}
                    <button disabled={busy}
                      onClick={() => applyM.mutate({ id: s.id, cfg: { ...s.config, enableShorts: false } })}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: busy ? "wait" : "pointer", fontFamily: "inherit",
                        background: cur === "off" ? C.loss : C.surface2, color: cur === "off" ? "#fff" : C.muted,
                        border: `1px solid ${cur === "off" ? C.loss : C.line}`, borderRadius: 9, padding: "8px 12px", fontSize: 12.5, fontWeight: 700 }}>
                      {T("Shorts off", "כבה שורט")}
                    </button>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>
                    {cur === "off" || cur === "custom" ? T("Pick a preset to set how aggressively this bot shorts.", "בחר פריסט כדי לקבוע כמה אגרסיבי השורט.") : PRESET_NOTE[cur as PresetKey]}
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
