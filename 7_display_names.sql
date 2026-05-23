-- ══════════════════════════════════════════════════════
-- Public display names resolver
-- Run this in Supabase SQL Editor
-- Allows any authenticated user to resolve username → full name
-- Used by the home dashboard to show implementor full names
-- ══════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_display_names();

CREATE FUNCTION get_display_names()
RETURNS TABLE(username text, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT
    coalesce(raw_user_meta_data->>'username', split_part(email::text,'@',1))::text AS username,
    coalesce(raw_user_meta_data->>'full_name', '')::text AS full_name
  FROM auth.users
  WHERE coalesce(raw_user_meta_data->>'full_name','') <> '';
$$;
