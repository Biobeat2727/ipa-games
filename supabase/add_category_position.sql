-- Board order: categories display left-to-right (and reveal) in the order they
-- appear in the imported JSON instead of alphabetically by name.
-- Nullable and optional: rooms imported before this column exists keep
-- position = null and fall back to alphabetical order, so the app works either
-- way. Run this in the Supabase SQL editor.
alter table public.categories add column if not exists position integer;
