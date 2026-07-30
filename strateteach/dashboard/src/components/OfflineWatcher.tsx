import { useEffect } from "react";
import { useI18n } from "../i18n";
import { pushToast, dismissToast, toastSuccess } from "../lib/toast";

// Global OFFLINE indicator (screen-states audit item). Watches navigator.onLine +
// the window online/offline events and surfaces a sticky, non-blocking status toast
// (reusing the Step-2 ToastHost) while offline; auto-clears + shows a brief "back
// online" when the connection returns. No blocking scrim; renders nothing itself.
const OFFLINE_ID = "net-offline";

export default function OfflineWatcher() {
  const { lang } = useI18n();
  const he = lang === "he";

  useEffect(() => {
    const showOffline = () => pushToast({
      id: OFFLINE_ID, kind: "info", duration: null,
      title: he ? "אין חיבור לאינטרנט" : "You're offline",
      body: he ? "חלק מהנתונים עשויים להיות לא מעודכנים." : "Some data may be out of date.",
    });
    let wasOffline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (wasOffline) showOffline();

    const onOffline = () => { wasOffline = true; showOffline(); };
    const onOnline = () => {
      if (!wasOffline) return;
      wasOffline = false;
      dismissToast(OFFLINE_ID);
      toastSuccess(he ? "החיבור לאינטרנט חזר" : "Back online");
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => { window.removeEventListener("offline", onOffline); window.removeEventListener("online", onOnline); };
  }, [he]);

  return null;
}
