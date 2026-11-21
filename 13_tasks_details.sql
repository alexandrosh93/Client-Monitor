-- Task details: description and checklist (used by the task detail panel).
-- Run once in the Supabase SQL Editor. Safe to run again.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
