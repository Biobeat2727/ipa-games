-- Host-readable category flavor text, revealed Jeopardy-style at round start.
-- Nullable and optional: content without descriptions imports and plays exactly
-- as before. Run this in the Supabase SQL editor BEFORE importing content that
-- includes "description" fields — the import insert fails without the column.
alter table public.categories add column if not exists description text;
