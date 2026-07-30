import { useEffect, useRef } from "react";
import { api } from "../app/api";

// Global agent: browser notifications + a sound for new chat messages, and
// fires confetti (+ a celebratory chime) when an admin sends a reward.
export default function NotificationsAgent() {
  const me = useRef("");
  const lastMsgId = useRef(0);
  const lastReward = useRef(0);
  const lastTrades = useRef<number | null>(null);
  const lastNet = useRef<number | null>(null);
  const knownReqs = useRef<Set<string> | null>(null);
  const started = useRef(false);
  const audio = useRef<any>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const enabled = () => { try { return localStorage.getItem("algo770_notify") !== "0"; } catch (_e) { return true; } };
    try { if (enabled() && "Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {}); } catch (_e) { /* ignore */ }
    const notify = (title: string, body: string) => {
      if (!enabled()) return;
      try {
        if (!("Notification" in window) || Notification.permission !== "granted") return;
        // Mobile browsers reject `new Notification()` — use the service worker's
        // showNotification when available, falling back to the constructor.
        if ("serviceWorker" in navigator && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready
            .then((reg) => reg.showNotification(title, { body, icon: "/favicon.ico", data: { url: "/chat" } }))
            .catch(() => { try { new Notification(title, { body, icon: "/favicon.ico" }); } catch (_e) { /* */ } });
        } else {
          new Notification(title, { body, icon: "/favicon.ico" });
        }
      } catch (_e) { /* ignore */ }
    };
    const beep = (freq = 880, dur = 0.12, vol = 0.18) => {
      if (!enabled()) return;
      try {
        audio.current = audio.current || new (window.AudioContext || (window as any).webkitAudioContext)();
        const ac = audio.current; if (ac.state === "suspended") ac.resume();
        const o = ac.createOscillator(); const g = ac.createGain();
        o.connect(g); g.connect(ac.destination); o.type = "sine"; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(vol, ac.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
        o.start(); o.stop(ac.currentTime + dur);
      } catch (_e) { /* ignore */ }
    };

    api.myProfile().then((p: any) => { me.current = p.username; }).catch(() => {});
    api.chatPoll(0).then((r: any) => { const ms = r.messages || []; if (ms.length) lastMsgId.current = ms[ms.length - 1].id; }).catch(() => {});
    api.rewards(0).then((r: any) => { const rw = r.rewards || []; if (rw.length) lastReward.current = rw[rw.length - 1].id; }).catch(() => {});
    api.myAnalytics().then((a: any) => { lastTrades.current = a.trades; lastNet.current = a.netPnl; }).catch(() => {});
    api.friends().then((f: any) => { knownReqs.current = new Set<string>(f.incoming || []); }).catch(() => {});

    const chatTick = async () => {
      try {
        const r: any = await api.chatPoll(lastMsgId.current);
        const ms = r.messages || [];
        if (!ms.length) return;
        lastMsgId.current = ms[ms.length - 1].id;
        const incoming = ms.filter((m: any) => m.from_user && m.from_user !== me.current);
        if (incoming.length) {
          beep(880, 0.1);
          const last = incoming[incoming.length - 1];
          notify(`💬 ${last.from_user}`, (last.body || "").slice(0, 120));
        }
      } catch (_e) { /* ignore */ }
    };
    const rewardTick = async () => {
      try {
        const r: any = await api.rewards(lastReward.current);
        const rw = r.rewards || [];
        if (rw.length) {
          lastReward.current = rw[rw.length - 1].id;
          window.dispatchEvent(new Event("algo770-confetti"));
          beep(660, 0.14); setTimeout(() => beep(880, 0.14), 130); setTimeout(() => beep(1180, 0.22), 270);
          notify("🎉 Reward!", "You received a celebration");
        }
      } catch (_e) { /* ignore */ }
    };
    const friendTick = async () => {
      try {
        const f: any = await api.friends();
        const inc: string[] = f.incoming || [];
        if (knownReqs.current == null) { knownReqs.current = new Set(inc); return; }
        const fresh = inc.filter((u) => !knownReqs.current!.has(u));
        if (fresh.length) {
          beep(700, 0.12); setTimeout(() => beep(940, 0.16), 140);
          notify("👋 Friend request", `${fresh[fresh.length - 1]} wants to connect — open Chat to accept`);
        }
        knownReqs.current = new Set(inc);
      } catch (_e) { /* ignore */ }
    };
    const profitTick = async () => {
      try {
        const a: any = await api.myAnalytics();
        if (lastTrades.current != null && a.trades > lastTrades.current && a.netPnl > (lastNet.current ?? 0)) {
          const gained = a.netPnl - (lastNet.current ?? 0);
          beep(990, 0.16);
          notify("🎯 Profit taken", `+$${gained.toFixed(2)} · win rate ${a.winRate}%`);
        }
        lastTrades.current = a.trades; lastNet.current = a.netPnl;
      } catch (_e) { /* ignore */ }
    };

    // Poll only while the tab is VISIBLE. Every loop pauses when the tab is hidden
    // (background/locked phone) to save battery + cellular data, and resumes when
    // the user returns. Intervals are tuned a touch slower than before (chat 6→8s,
    // reward 7→12s, friend 9→20s, profit 30→60s) — still responsive, far fewer
    // requests. On return we fire an immediate catch-up so a message/reward/friend
    // request that landed while away surfaces right away, not after a full interval.
    let timers: ReturnType<typeof setInterval>[] = [];
    const startPolling = () => {
      if (timers.length) return;
      timers = [
        setInterval(chatTick, 8000),
        setInterval(rewardTick, 12000),
        setInterval(friendTick, 20000),
        setInterval(profitTick, 60000),
      ];
    };
    const stopPolling = () => { timers.forEach(clearInterval); timers = []; };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { stopPolling(); return; }
      chatTick(); rewardTick(); friendTick();   // catch up on whatever arrived while away
      startPolling();
    };
    if (document.visibilityState !== "hidden") startPolling();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stopPolling(); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  return null;
}
