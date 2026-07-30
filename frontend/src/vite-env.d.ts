/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** A8-H2 kill control gate. Kill UI renders ONLY when this is exactly 'true'. Absent/anything-else = OFF. */
  readonly VITE_OPERATOR_KILL_ENABLED?: string
  /** Ops Harness read-only panel gate (Slice A). Renders ONLY when exactly 'true'. Absent/else = OFF. */
  readonly VITE_OPERATOR_HARNESS_ENABLED?: string
  /** Optional build-time commit SHA (e.g. Railway RAILWAY_GIT_COMMIT_SHA). Absent → build commit 'unknown'. */
  readonly VITE_BUILD_COMMIT?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
