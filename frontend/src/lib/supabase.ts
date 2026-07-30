// supabase.ts — browser Supabase client (S5 Slice 1c). PUBLIC anon key only (RLS + the operator_status
// is_operator gate protect data). NEVER service_role / Vault / DSN / exchange keys in the browser.
// Imported by main.tsx only; tests inject a mock client instead, so they never hit this env read.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (see .env.example)')
}

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})
