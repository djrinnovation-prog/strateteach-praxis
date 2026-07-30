import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ListChecks, ServerCrash, RotateCw } from "lucide-react";
import { api, hasToken, saveToken, setRole, setMain, setOwner, setLegalEditor, setLegalCopyWriter, setItEditor, setBizEditor, setContentEditor, isMainAdmin, restoreExchangeCredsFromServer } from "./app/api";
import { warmBootQueries, fetchMe, queryClient } from "./app/queryClient";
import { useI18n } from "./i18n";
import { C, UI, SHADOW } from "./theme";
import BootSplash from "./components/BootSplash";
import MusicPlayer from "./components/MusicPlayer";
import Login from "./screens/Login";
import Shell from "./components/Shell.tsx";
import RiskGate from "./components/RiskGate";
import ScreenAgent from "./components/ScreenAgent";
import NotificationsAgent from "./components/NotificationsAgent";
import Confetti from "./components/Confetti";
import Avatar from "./components/Avatar";
import Onboarding from "./components/Onboarding";
import WelcomeOnboarding from "./components/WelcomeOnboarding";
import Require2FA from "./components/Require2FA";
import RequirePrivacy from "./components/RequirePrivacy";
import RequirePasswordChange from "./components/RequirePasswordChange";
import SignupForm from "./screens/SignupForm";
import WelcomeWarning from "./screens/WelcomeWarning";
import OnboardingWelcome from "./screens/OnboardingWelcome";
import { DemoBanner, FeedbackButton, DemoIntro } from "./components/DemoKit";
import MaintenanceScreen, { MaintenanceBanner } from "./components/MaintenanceScreen";
import ToastHost from "./lib/toast";
import ReviewMode from "./components/ReviewMode";
import OfflineWatcher from "./components/OfflineWatcher";
import AnalyticsTracker from "./components/AnalyticsTracker";
import AnalyticsConsentModal from "./components/AnalyticsConsentModal";
import { setAnalyticsConsentCache, rotateAnalyticsSession, ev as track12 } from "./lib/analytics";
import { TABBAR_H } from "./components/TabBar";

export interface User { username: string; role: string; }

const RISK_KEY = "algo770_risk_ack";

// A GENUINE auth failure — the only case where we drop the session on boot. An
// ApiError carries the HTTP `.status`; 401/403 mean the token is bad/expired.
// Everything else (status >= 500, OR no status at all = a network/offline/timeout
// reject that never reached the server) is TRANSIENT and must NOT clear the token.
function isAuthFailure(error: unknown): boolean {
  const status = (error as any)?.status;
  return status === 401 || status === 403;
}

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();
  const [user, setUser] = useState<User | null>(null);
  // Set after a ?welcome=<token> redeem: holds the now-authenticated account while
  // the branded "ראה הוזהרת" notice + phone capture is shown, before entering the app.
  const [welcome, setWelcome] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Set when the boot /auth/me probe (or a magic-link redeem) fails for a
  // TRANSIENT reason — network/offline/timeout or a server hiccup (>=500), i.e.
  // NOT a genuine 401/403 auth failure. We keep the token in this case and show a
  // recoverable "couldn't reach the server — Retry" panel instead of logging the
  // user out, so a momentary blip / cold backend never kicks a real user to Login.
  const [bootError, setBootError] = useState(false);
  const [bootDone, setBootDone] = useState(false); // boot splash fully removed (after its fade-out)
  const [riskOk, setRiskOk] = useState(() => localStorage.getItem(RISK_KEY) === "1");
  // Global maintenance gate: { maintenance, isAdmin } once fetched, else null.
  // FAIL OPEN — any error resolves to maintenance:false so a user is never trapped.
  const [maint, setMaint] = useState<{ maintenance: boolean; isAdmin: boolean } | null>(null);
  const [themeV, setThemeV] = useState(0); // bump to re-skin the whole tree on theme change
  // Mobile boot was slow because ~a dozen non-critical widgets (animated
  // backdrop, music, agents, confetti, onboarding) all fired their own API
  // calls on mount and competed with the dashboard's first paint. Defer them a
  // beat so the Shell + Home render first; they fade in right after.
  const deferred = useDeferredMount();

  useEffect(() => { setRole(user?.role); }, [user]);
  // Once authenticated (any login path), pull the ENCRYPTED server-side exchange-key
  // backup if this device has no local copy — so the connection follows the user across
  // devices / survives a cache-clear. One-shot per session; a no-op when local keys exist.
  useEffect(() => { if (user) void restoreExchangeCredsFromServer(); }, [user]);
  // Analytics consent (Item 2/3): on login, start a fresh analytics session and probe
  // the server for this user's consent state → cache it (the gate that suppresses ALL
  // client emits). Unknown/error → treat as NOT consented (fail closed = no tracking).
  // The consent screen (RequireAnalyticsConsent) updates the cache after Accept/Decline.
  useEffect(() => {
    if (!user) { setAnalyticsConsentCache(undefined); return; }
    rotateAnalyticsSession();
    let alive = true;
    api.getAnalyticsConsent()
      .then((r: any) => { if (alive) { const c = !!r?.consent; setAnalyticsConsentCache(c); if (c) track12.userLoggedIn(); } })
      .catch(() => { if (alive) setAnalyticsConsentCache(false); });
    return () => { alive = false; };
  }, [user]);
  // Once a user is authenticated, fetch the global maintenance gate. FAIL OPEN: on
  // any error we treat maintenance as OFF (fall back to the local role for isAdmin),
  // so a connectivity blip never traps a user behind the splash.
  useEffect(() => {
    if (!user) { setMaint(null); return; }
    let alive = true;
    api.maintenanceStatus()
      .then((m: any) => { if (alive) setMaint({ maintenance: !!m.maintenance, isAdmin: !!m.isAdmin }); })
      .catch(() => { if (alive) setMaint({ maintenance: false, isAdmin: user.role === "admin" }); });
    return () => { alive = false; };
  }, [user]);
  useEffect(() => {
    const f = () => setThemeV((v) => v + 1);
    window.addEventListener("algo770-theme", f);
    return () => window.removeEventListener("algo770-theme", f);
  }, []);
  // Backend maintenance backstop: any API call that returns 503 (the server-side
  // gate cutting a non-admin off) flips us to the MaintenanceScreen — so a stale
  // cached build, or a session that predates the gate, is still trapped correctly.
  // Admins are never 503'd server-side, so we ignore the signal for them.
  const userRef = useRef<User | null>(null);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => {
    const onMaint = () => {
      if (userRef.current?.role === "admin") return;
      setMaint({ maintenance: true, isAdmin: false });
    };
    window.addEventListener("algo770-maintenance", onMaint);
    return () => window.removeEventListener("algo770-maintenance", onMaint);
  }, []);

  // Boot the session. Extracted from the mount effect so the "couldn't reach the
  // server" retry panel can re-run it on demand. Every failure path here is
  // status-aware: we drop the session ONLY on a genuine 401/403 (isAuthFailure);
  // any transient failure (network/offline/timeout or a >=500 server hiccup) KEEPS
  // the token and raises bootError, which renders the recoverable retry panel.
  const runBoot = React.useCallback(() => {
    setBootError(false);
    setLoading(true);
    // One-time welcome link: ?welcome=<token> logs into the EXISTING account it was
    // minted for, then shows the branded notice + phone capture before the app.
    const welcomeTok = new URLSearchParams(window.location.search).get("welcome");
    if (welcomeTok) {
      api.welcomeLogin(welcomeTok)
        .then((out: any) => {
          saveToken(out.token); setRole(out.role); warmBootQueries(); setWelcome({ username: out.username, role: out.role });
          try { const u = new URL(window.location.href); u.searchParams.delete("welcome"); window.history.replaceState({}, "", u.pathname); } catch (_e) { /* */ }
        })
        .catch((e: unknown) => { if (isAuthFailure(e)) { saveToken(null); setWelcome(null); } else { setBootError(true); } })
        .finally(() => setLoading(false));
      return;
    }
    // One-tap demo link: ?demo=<token> logs the tester in for a fresh 30 minutes.
    const demoTok = new URLSearchParams(window.location.search).get("demo");
    if (demoTok) {
      api.demoLogin(demoTok)
        .then((out: any) => {
          saveToken(out.token); setRole(out.role); warmBootQueries(); setUser({ username: out.username, role: out.role });
          try { const u = new URL(window.location.href); u.searchParams.delete("demo"); window.history.replaceState({}, "", u.pathname); } catch (_e) { /* */ }
          sessionStorage.setItem("algo770_landed", "1"); nav("/", { replace: true });
        })
        .catch((e: unknown) => { if (isAuthFailure(e)) { saveToken(null); setUser(null); } else { setBootError(true); } })
        .finally(() => setLoading(false));
      return;
    }
    if (!hasToken()) { setLoading(false); return; }
    // Warm the gate queries (2FA / privacy / section-access) in PARALLEL with
    // /auth/me so they don't run as a back-to-back serial chain of full-screen
    // spinners after this one resolves (refresh + direct-URL paths).
    warmBootQueries();
    // Share the single warmed /auth/me round-trip (same ["mustChangePw"] query the
    // password-change gate reads) instead of firing our own — so /auth/me loads once.
    fetchMe()
      .then((me) => {
        setMain((me as any).isMain);
        setOwner((me as any).isOwner);
        setLegalEditor((me as any).isLegalEditor);
        setLegalCopyWriter((me as any).isLegalCopyWriter);
        setItEditor((me as any).isItEditor);
        setBizEditor((me as any).isBizEditor);
        setContentEditor((me as any).isContentEditor);
        setUser(me as User);
        // Always open the app on the Home springboard for the first load of a
        // session — even if the browser restored a deep URL like /scanner.
        if (!sessionStorage.getItem("algo770_landed")) { sessionStorage.setItem("algo770_landed", "1"); nav("/", { replace: true }); }
      })
      // Only a genuine 401/403 ends the session. A transient failure (offline /
      // timeout / cold backend 5xx) MUST keep the token — we surface a retry panel
      // instead of wiping the session and bouncing the user to Login.
      .catch((e: unknown) => { if (isAuthFailure(e)) { saveToken(null); setUser(null); } else { setBootError(true); } })
      .finally(() => setLoading(false));
  }, [nav]);

  useEffect(() => { runBoot(); }, [runBoot]);

  function logout() {
    saveToken(null);
    setUser(null);
    // Drop all cached queries so the NEXT user who logs in on this tab starts with a
    // clean slate — the boot queries (me / 2FA / privacy / section-access) now carry
    // a staleTime, so without this a fast re-login could read the prior user's data.
    queryClient.clear();
  }

  // Once boot data resolves, keep the splash mounted one more beat so it can
  // fade out and reveal the app beneath (no hard cut / empty flash), then drop
  // it. This is purely cosmetic — warmBootQueries still runs in parallel above,
  // so it adds nothing to actual startup time.
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => setBootDone(true), 560); // > the 0.5s fade-out
    return () => clearTimeout(t);
  }, [loading]);

  function renderContent() {
    if (loading) return null; // the splash covers everything until data is ready

    // New-hire onboarding link (?onboard=<token>) → the login-free welcome/explanation screen.
    // Shown before the auth gate so it opens without a session.
    const onboardTok = new URLSearchParams(window.location.search).get("onboard");
    if (onboardTok) return <OnboardingWelcome token={onboardTok} />;

    // ?welcome redeem succeeded → show the branded notice + phone capture, then enter.
    if (welcome) return (
      <WelcomeWarning onContinue={() => { setUser(welcome); setWelcome(null); sessionStorage.setItem("algo770_landed", "1"); nav("/", { replace: true }); }} />
    );

    // Transient boot failure (offline / timeout / cold-backend 5xx) — the token was
    // KEPT (only a real 401/403 clears it), so we show a recoverable retry panel
    // INSTEAD of bouncing the user to Login. Retry re-runs the boot probe. This is
    // checked before /join + Login so a held session is never wrongly discarded.
    if (!user && bootError) return <BootErrorPanel onRetry={runBoot} />;

    // Public self-signup page (no login needed).
    if (!user && window.location.pathname === "/join") return <SignupForm />;
    if (!user) return <Login onLoggedIn={(u: User) => { warmBootQueries(); setUser(u); sessionStorage.setItem("algo770_landed", "1"); nav("/", { replace: true }); }} />;

    // Maintenance gate. Admins ALWAYS bypass (the SAME role==="admin" check used
    // app-wide). The gate blocks ONLY when (flag ON) AND (user is NOT admin). While
    // the status is still loading (maint===null) we fail open and render the app.
    const isAdminUser = maint ? maint.isAdmin : user.role === "admin";
    if (maint?.maintenance && !isAdminUser) return <MaintenanceScreen onLogout={logout} />;

    if (!riskOk) return (
      <RiskGate
        onAccept={() => { localStorage.setItem(RISK_KEY, "1"); setRiskOk(true); }}
        onDecline={logout}
      />
    );

    return (
      <React.Fragment key={themeV}>
        {/* Forced set-new-password gate: if an admin reset this user's password with
            "force change on next login", they're sent straight here and nothing else
            is reachable until they pick a new one. Outermost so it precedes 2FA-mgmt
            and privacy chrome. */}
        <RequirePasswordChange onLogout={logout}>
        <Require2FA user={user} onLogout={logout}>
         <RequirePrivacy>
          {/* Admins keep FULL access while maintenance is ON — just a heads-up banner
              with a one-tap "turn off". Non-admins never reach here (gated above). */}
          {maint?.maintenance && (maint.isAdmin || user.role === "admin") && (
            <MaintenanceBanner canTurnOff={isMainAdmin()} onTurnOff={async () => {
              try { await api.setMaintenance(false); setMaint({ maintenance: false, isAdmin: true }); }
              catch (_e) { /* leave the banner up if the toggle failed */ }
            }} />
          )}
          {/* Critical path: the app shell renders immediately. */}
          <Shell user={user} onLogout={logout} />
          {/* Global honest-status / honest-error toast host (financial-safety layer).
              Non-deferred so money errors surface promptly; non-blocking + dismissible. */}
          <ToastHost />
          {/* Global offline indicator — sticky status toast while offline, auto-clears. */}
          <OfflineWatcher />
          {/* REVIEW MODE — owner/admin-only in-app feedback collector. A floating toggle +
              per-screen "Add fix" that persists notes (localStorage) across navigation and
              compiles them into ONE copy-ready prompt. Self-gates via isAdminOrOwner (renders
              null for everyone else); non-deferred so it's promptly available on every screen. */}
          <ReviewMode />
          {/* Privacy-safe analytics — app_open + per-screen views (Activation KPIs). */}
          <AnalyticsTracker />
          {/* One-time analytics-consent notice (Item 3). Overlay, not a gate — Decline
              still leaves the app fully usable; re-toggle lives in My-Data settings. */}
          <AnalyticsConsentModal />
          {/* Connect-exchange is NO LONGER an always-on floating banner. A user who isn't
              going live never sees a prompt; connecting is surfaced as a popup only when
              someone opts into LIVE without an exchange (see ConnectExchangeModal, wired to
              the Demo/Live toggle in Home). */}
          {/* Non-critical chrome: mounted a beat later so it doesn't compete with
              first paint / the dashboard's own data fetches on mobile. */}
          {deferred && (
            <>
              {/* Drifting market-symbol backdrop ("running coins") is now rendered INSIDE the
                  shared HomeBackdrop (see HomeBackdrop.tsx), so it layers correctly ABOVE the
                  opaque skin fill on EVERY screen — including Home, whose own opaque zIndex:1
                  root previously covered this app-level z0 layer, hiding the coins entirely.
                  Owners portal renders HomeBackdrop in `quiet` mode → no coins there (same as
                  the old !/owners skip). */}
              <ScreenAgent />
              <NotificationsAgent />
              <Confetti />
              <Avatar />
              {/* First-run high-level welcome (once-only, complements the guided tour). */}
              <WelcomeOnboarding />
              <Onboarding />
              <DemoBanner />
              <DemoIntro />
              <FeedbackButton />
              <QuickStartReturn />
              <MusicPlayer />
            </>
          )}
         </RequirePrivacy>
        </Require2FA>
        </RequirePasswordChange>
      </React.Fragment>
    );
  }

  return (
    <>
      {renderContent()}
      {/* The US-connectivity notice is no longer a global banner — it now renders as
          inline written text inside the Exchange connect area only (screens/Exchange.tsx,
          gated by the SHOW_US_CONNECT_NOTICE flag there). */}
      {(loading || !bootDone) && <BootSplash fadingOut={!loading} />}
    </>
  );
}

// Returns false on first render, then true once the browser is idle (or after a
// short timeout) — used to defer non-critical chrome past the first paint.
function useDeferredMount(delay = 1200): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as any;
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(() => setReady(true), { timeout: delay });
      return () => w.cancelIdleCallback?.(id);
    }
    const tmr = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(tmr);
  }, []);
  return ready;
}

// Shown when the boot probe fails for a TRANSIENT reason (offline / timeout /
// cold-backend 5xx) while a session token is still held. The token is kept — this
// is a recoverable "couldn't reach the server" prompt, NOT a logout — and Retry
// simply re-runs the boot probe. Bilingual (HE/EN) + skin-themed; RTL is handled
// app-wide via the document `dir`, so the centred layout needs no extra mirroring.
function BootErrorPanel({ onRetry }: { onRetry: () => void }) {
  const { lang } = useI18n();
  const he = lang === "he";
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center",
      padding: 24, fontFamily: UI, background: C.bg }}>
      <div style={{ width: "100%", maxWidth: 400, textAlign: "center", boxSizing: "border-box",
        borderRadius: 20, padding: "34px 28px", background: C.surface,
        border: `1px solid ${C.line}`, boxShadow: SHADOW }}>
        <div style={{ width: 64, height: 64, margin: "0 auto 18px", borderRadius: 18,
          display: "grid", placeItems: "center", background: C.goldDim, color: C.gold }}>
          <ServerCrash size={30} strokeWidth={2.2} />
        </div>
        <h2 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 800, color: C.text }}>
          {he ? "אין חיבור לשרת" : "Can’t reach the server"}
        </h2>
        <p style={{ margin: "0 0 24px", fontSize: 15, lineHeight: 1.55, color: C.muted }}>
          {he
            ? "לא הצלחנו להגיע לשרת. בדוק את החיבור ונסה שוב."
            : "Couldn’t reach the server. Check your connection and try again."}
        </p>
        <button onClick={onRetry} className="gbtn" style={{ width: "100%",
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          borderRadius: 12, padding: "13px 18px", fontWeight: 800, fontSize: 15,
          cursor: "pointer", fontFamily: UI }}>
          <RotateCw size={17} /> {he ? "נסה שוב" : "Retry"}
        </button>
      </div>
    </div>
  );
}

// Floating "back to steps" button — appears on whatever screen the user opened
// from the 3-step quick-start, and takes them back to the wizard where they left.
function QuickStartReturn() {
  const nav = useNavigate();
  const loc = useLocation();
  const { lang } = useI18n();
  const [active, setActive] = useState(() => sessionStorage.getItem("algo770_qs") === "1");
  useEffect(() => {
    const h = () => setActive(sessionStorage.getItem("algo770_qs") === "1");
    window.addEventListener("qs-change", h);
    return () => window.removeEventListener("qs-change", h);
  }, []);
  if (!active || loc.pathname === "/") return null;
  return (
    <button onClick={() => nav("/")} className="gbtn" style={{ position: "fixed", insetInlineStart: 16, bottom: `calc(${TABBAR_H + 10}px + env(safe-area-inset-bottom, 0px))`, zIndex: 43,
      display: "inline-flex", alignItems: "center", gap: 8,
      borderRadius: 999, padding: "10px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: UI }}>
      <ListChecks size={16} /> {lang === "he" ? "חזרה לצעדים" : "Back to steps"}
    </button>
  );
}
