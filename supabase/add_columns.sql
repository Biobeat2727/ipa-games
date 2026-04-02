-- ============================================================
-- Migration: Add columns for feature batch (sounds, double tap, turn persistence)
-- Run this in the Supabase SQL editor before deploying the updated frontend.
-- ============================================================

-- 1. Turn persistence on rooms table
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS current_turn_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;

-- 2. Double Tap mechanic on questions table
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS is_double_tap BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Update questions_public view to expose is_double_tap
-- (Drop and recreate so the new column is included)
DROP VIEW IF EXISTS public.questions_public;
CREATE VIEW public.questions_public AS
  SELECT
    id,
    category_id,
    answer,
    point_value,
    is_answered,
    answered_by_team_id,
    is_double_tap
  FROM public.questions;

-- Grant SELECT on the view to anon and authenticated roles
GRANT SELECT ON public.questions_public TO anon, authenticated;

-- ============================================================
-- Notes:
-- • current_turn_team_id: nullable, no RLS changes needed for reads.
--   The host UPDATE call goes through the existing rooms UPDATE policy.
-- • is_double_tap: default false, existing rows are unaffected.
-- • The questions_public view is read-only; no additional RLS needed.
-- ============================================================
