-- ============================================================
-- PRAXIS — Auth Profile Trigger
-- Migration: 002_auth_profile_trigger.sql
-- Purpose: Auto-create profiles row on auth.users INSERT
-- Depends on: 001_initial_schema.sql (profiles table must exist)
-- Required before: first user signup
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
