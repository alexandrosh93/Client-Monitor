-- ══════════════════════════════════════════════════════
-- Username → Email resolver for login
-- Run this in Supabase SQL Editor
-- Allows logging in with display name OR username OR full email
-- ══════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_login_email(text);

CREATE FUNCTION get_login_email(p_username text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT email::text
  FROM auth.users
  WHERE
    -- match by display name stored in user_metadata (e.g. "John")
    lower(raw_user_meta_data->>'username') = lower(p_username)
    -- match by the username@avps.local convention
    OR lower(email::text) = lower(p_username) || '@avps.local'
    -- match by full email
    OR lower(email::text) = lower(p_username)
  ORDER BY created_at
  LIMIT 1;
$$;
