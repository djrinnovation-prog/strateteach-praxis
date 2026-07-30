import { QueryClient } from "@tanstack/react-query";
import { api } from "./api";

// Shared singleton so the app can warm boot queries (me / 2FA / privacy /
// section-access) in PARALLEL at startup — the gates below read them straight
// from this cache instead of each firing its own serial round-trip.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// Transient-only retry for the boot /auth/me probe. A genuine auth failure
// (401/403 → ApiError with that .status) must NEVER be retried — it's the
// signal to drop the session. But a network/offline/timeout reject (a bare
// TypeError with NO .status) or a server hiccup (status >= 500, e.g. a cold
// backend returning 502/503) is transient: retry it a couple of times before
// surfacing the error, so a momentary blip doesn't bubble up as a logout.
export function isTransientError(error: unknown): boolean {
  const status = (error as any)?.status;
  if (typeof status !== "number") return true; // no status = network/offline/timeout
  return status >= 500;                          // server-side hiccup
}
const bootRetry = (failureCount: number, error: unknown) =>
  isTransientError(error) && failureCount < 2;

// Fire the gate queries concurrently the moment we know there's a session, so
// Require2FA / RequirePrivacy / Shell don't each block on a back-to-back
// round-trip. react-query dedupes by key, so when those components mount they
// share these in-flight promises (or already-resolved data) — collapsing a
// ~10s serial chain of empty spinners into ~one round-trip.
//
// staleTime here is generous (60s) and the gate components read the SAME keys
// with a matching staleTime, so when they mount the warm data is still FRESH and
// they reuse it instead of each firing a second identical round-trip on load.
export function warmBootQueries() {
  // Same transient-only retry as fetchMe() below — they share the ["mustChangePw"]
  // key and this prefetch starts the request, so it must carry the matching retry
  // policy for the retry to actually apply to the boot /auth/me round-trip.
  queryClient.prefetchQuery({ queryKey: ["mustChangePw"], queryFn: () => api.me(), retry: bootRetry, staleTime: 60_000 });
  queryClient.prefetchQuery({ queryKey: ["my2fa"], queryFn: () => api.get2fa(), retry: false, staleTime: 60_000 });
  queryClient.prefetchQuery({ queryKey: ["privacyAck"], queryFn: () => api.getPrivacyAck(), retry: false, staleTime: 60_000 });
  queryClient.prefetchQuery({ queryKey: ["sectionAccess"], queryFn: () => api.sectionAccess(), staleTime: 60_000 });
}

// Resolve /auth/me through the SAME ["mustChangePw"] query the warm-up seeds and
// the password-change gate reads. App's boot calls this instead of api.me()
// directly, so /auth/me is fetched ONCE per load and shared everywhere (the
// in-flight prefetch is reused; an already-fresh result is returned outright).
export function fetchMe() {
  return queryClient.fetchQuery({ queryKey: ["mustChangePw"], queryFn: () => api.me(), retry: bootRetry, staleTime: 60_000 });
}
