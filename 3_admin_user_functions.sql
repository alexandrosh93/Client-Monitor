-- ══════════════════════════════════════════════════════
-- Admin User Management Functions
-- Run this ONCE in Supabase SQL Editor
-- After running, user management works directly from the app
-- ══════════════════════════════════════════════════════

-- Drop first to allow return-type changes
DROP FUNCTION IF EXISTS admin_list_users();
DROP FUNCTION IF EXISTS admin_create_user(text,text,text,text);
DROP FUNCTION IF EXISTS admin_create_user(text,text,text,text,text);
DROP FUNCTION IF EXISTS admin_update_user(uuid,text,text,text);
DROP FUNCTION IF EXISTS admin_update_user(uuid,text,text,text,text);
DROP FUNCTION IF EXISTS admin_update_email(uuid,text);
DROP FUNCTION IF EXISTS admin_set_password(uuid,text);
DROP FUNCTION IF EXISTS admin_delete_user(uuid);

-- List all users (admin only)
CREATE FUNCTION admin_list_users()
RETURNS TABLE(id uuid, email text, username text, full_name text, role text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, public
AS $$
BEGIN
  IF NOT (
    coalesce(auth.jwt()->'app_metadata'->>'role','') = 'admin' OR
    coalesce(auth.jwt()->'user_metadata'->>'role','') = 'admin'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT
    u.id::uuid,
    u.email::text,
    coalesce(u.raw_user_meta_data->>'username', split_part(u.email::text,'@',1))::text AS username,
    coalesce(u.raw_user_meta_data->>'full_name', '')::text AS full_name,
    coalesce(u.raw_app_meta_data->>'role', u.raw_user_meta_data->>'role', 'user')::text AS role,
    u.created_at::timestamptz
  FROM auth.users u ORDER BY u.created_at;
END;
$$;

-- Create a new user (admin only)
-- p_login: username (becomes username@avps.local) or full email
CREATE FUNCTION admin_create_user(
  p_login text, p_password text, p_username text, p_full_name text, p_role text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, public
AS $$
DECLARE
  v_email text;
  v_id uuid := gen_random_uuid();
BEGIN
  IF NOT (
    coalesce(auth.jwt()->'app_metadata'->>'role','') = 'admin' OR
    coalesce(auth.jwt()->'user_metadata'->>'role','') = 'admin'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  v_email := CASE WHEN p_login LIKE '%@%' THEN lower(p_login)
                  ELSE lower(p_login) || '@avps.local' END;

  INSERT INTO auth.users(
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud, role
  ) VALUES (
    v_id, '00000000-0000-0000-0000-000000000000',
    v_email, crypt(p_password, gen_salt('bf')), now(),
    jsonb_build_object('provider','email','providers',ARRAY['email'],'role',p_role),
    jsonb_build_object('username', p_username, 'full_name', p_full_name),
    now(), now(), 'authenticated', 'authenticated'
  );

  INSERT INTO auth.identities(
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_id, v_email,
    jsonb_build_object('sub', v_id::text, 'email', v_email),
    'email', now(), now(), now()
  );

  RETURN v_id;
END;
$$;

-- Update user username, full name, role and email (admin only)
CREATE FUNCTION admin_update_user(
  p_user_id uuid, p_username text, p_full_name text, p_role text, p_new_email text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, public
AS $$
BEGIN
  IF NOT (
    coalesce(auth.jwt()->'app_metadata'->>'role','') = 'admin' OR
    coalesce(auth.jwt()->'user_metadata'->>'role','') = 'admin'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  -- Update metadata and email in auth.users atomically
  UPDATE auth.users
  SET raw_user_meta_data = coalesce(raw_user_meta_data,'{}') ||
        jsonb_build_object('username', p_username, 'full_name', p_full_name),
      raw_app_meta_data = coalesce(raw_app_meta_data,'{}') ||
        jsonb_build_object('role', p_role),
      email = p_new_email,
      email_confirmed_at = now(),
      updated_at = now()
  WHERE id = p_user_id;

  -- Keep auth.identities in sync
  UPDATE auth.identities
  SET provider_id = p_new_email,
      identity_data = identity_data || jsonb_build_object('email', p_new_email),
      updated_at = now()
  WHERE user_id = p_user_id AND provider = 'email';
END;
$$;

-- Update a user's email (admin only)
CREATE FUNCTION admin_update_email(p_user_id uuid, p_new_email text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, public
AS $$
BEGIN
  IF NOT (
    coalesce(auth.jwt()->'app_metadata'->>'role','') = 'admin' OR
    coalesce(auth.jwt()->'user_metadata'->>'role','') = 'admin'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  UPDATE auth.users
  SET email = p_new_email,
      email_confirmed_at = now(),
      updated_at = now()
  WHERE id = p_user_id;

  UPDATE auth.identities
  SET provider_id = p_new_email,
      identity_data = identity_data || jsonb_build_object('email', p_new_email),
      updated_at = now()
  WHERE user_id = p_user_id AND provider = 'email';
END;
$$;

-- Reset any user's password (admin only)
CREATE FUNCTION admin_set_password(p_user_id uuid, p_password text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, public
AS $$
BEGIN
  IF NOT (
    coalesce(auth.jwt()->'app_metadata'->>'role','') = 'admin' OR
    coalesce(auth.jwt()->'user_metadata'->>'role','') = 'admin'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(p_password, gen_salt('bf')),
      updated_at = now()
  WHERE id = p_user_id;
END;
$$;

-- Delete a user (admin only)
CREATE FUNCTION admin_delete_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, public
AS $$
BEGIN
  IF NOT (
    coalesce(auth.jwt()->'app_metadata'->>'role','') = 'admin' OR
    coalesce(auth.jwt()->'user_metadata'->>'role','') = 'admin'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;
