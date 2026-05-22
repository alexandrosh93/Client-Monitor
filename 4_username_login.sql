-- ══════════════════════════════════════════════════════
-- Username → Email resolver for login
-- Run this in Supabase SQL Editor
-- Allows logging in with display name OR username OR full email
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_login_email(p_username text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT email
  FROM auth.users
  WHERE
    -- match by display name stored in user_metadata (e.g. "Admin", "AH")
    lower(raw_user_meta_data->>'username') = lower(p_username)
    -- match by username@avps.local convention
    OR lower(email) = lower(p_username) || '@avps.local'
  ORDER BY created_at
  LIMIT 1;
$$;
