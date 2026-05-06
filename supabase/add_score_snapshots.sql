-- ============================================================
-- Migration: Add score_snapshots column for between-rounds graph
-- Run this in the Supabase SQL editor before deploying the updated frontend.
-- ============================================================

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS score_snapshots JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================
-- Notes:
-- • score_snapshots: stores an array of { label, scores: [{team_id, score}] }
--   snapshots captured at round transitions for the score history graph.
-- • Default empty array — existing rooms are unaffected.
-- • No RLS changes needed; host writes via existing rooms UPDATE policy.
-- ============================================================
