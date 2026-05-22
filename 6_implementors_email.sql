-- ══════════════════════════════════════════════════════
-- Step 1: Add email column to implementors table
-- Run in Supabase SQL Editor
-- ══════════════════════════════════════════════════════

ALTER TABLE public.implementors ADD COLUMN IF NOT EXISTS email text DEFAULT '';

-- Update existing implementors with known emails if needed:
-- UPDATE public.implementors SET email = 'ah@premiersoft.com.cy' WHERE name = 'AH';
