import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { track, trackScreen } from "../lib/analytics";

// Mounted once inside the authenticated app tree. Fires `app_open` on mount and a
// deduped `screen_view` on every route change (Activation KPIs). Renders nothing.
export default function AnalyticsTracker() {
  const loc = useLocation();
  useEffect(() => { track("app_open"); }, []);
  useEffect(() => { trackScreen(loc.pathname || "/"); }, [loc.pathname]);
  return null;
}
