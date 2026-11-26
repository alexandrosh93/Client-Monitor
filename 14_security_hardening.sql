-- Apply after the earlier schema scripts. See SECURITY-SETUP.md for rollout.
BEGIN;

-- Keep credential and account changes on the Supabase Admin API.
DROP FUNCTION IF EXISTS public.admin_list_users();
DROP FUNCTION IF EXISTS public.admin_create_user(text,text,text,text);
DROP FUNCTION IF EXISTS public.admin_create_user(text,text,text,text,text);
DROP FUNCTION IF EXISTS public.admin_update_user(uuid,text,text,text);
DROP FUNCTION IF EXISTS public.admin_update_user(uuid,text,text,text,text);
DROP FUNCTION IF EXISTS public.admin_update_user(uuid,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.admin_update_email(uuid,text);
DROP FUNCTION IF EXISTS public.admin_set_password(uuid,text);
DROP FUNCTION IF EXISTS public.admin_delete_user(uuid);
DROP FUNCTION IF EXISTS public.get_login_email(text);

CREATE SCHEMA IF NOT EXISTS client_monitor_private;
REVOKE ALL ON SCHEMA client_monitor_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA client_monitor_private TO authenticated;

-- Look up the current server-managed role so a demoted user loses access
-- even if their signed token still contains an old app_metadata claim.
CREATE OR REPLACE FUNCTION client_monitor_private.current_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id = (SELECT auth.uid());
$$;
REVOKE ALL ON FUNCTION client_monitor_private.current_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION client_monitor_private.current_role() TO authenticated;

-- These tables belong to one shared staff workspace. Restrictive policies
-- apply alongside existing permissive policies, including any extra policies.
DO $$
DECLARE
  relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['clients','implementors','modules','tasks','client_projects','client_project_history','audit_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', relation);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', relation);
    EXECUTE format('DROP POLICY IF EXISTS staff_access ON public.%I', relation);
    EXECUTE format(
      'CREATE POLICY staff_access ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
       USING ((SELECT client_monitor_private.current_role()) IN (''user'', ''admin''))
       WITH CHECK ((SELECT client_monitor_private.current_role()) IN (''user'', ''admin''))', relation
    );
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS client_delete_admin ON public.clients;
CREATE POLICY client_delete_admin ON public.clients AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT client_monitor_private.current_role()) = 'admin');
DROP POLICY IF EXISTS project_delete_admin ON public.client_projects;
CREATE POLICY project_delete_admin ON public.client_projects AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT client_monitor_private.current_role()) = 'admin');

-- Staff may read the reference lists. Only admins can change them.
DO $$
DECLARE
  relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['implementors','modules']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_%I ON public.%I', relation, relation);
    EXECUTE format('DROP POLICY IF EXISTS staff_reference_read ON public.%I', relation);
    EXECUTE format('DROP POLICY IF EXISTS admin_reference_write ON public.%I', relation);
    EXECUTE format('CREATE POLICY staff_reference_read ON public.%I FOR SELECT TO authenticated USING (true)', relation);
    EXECUTE format(
      'CREATE POLICY admin_reference_write ON public.%I FOR ALL TO authenticated
       USING ((SELECT client_monitor_private.current_role()) = ''admin'')
       WITH CHECK ((SELECT client_monitor_private.current_role()) = ''admin'')', relation
    );
    EXECUTE format('DROP POLICY IF EXISTS reference_insert_admin ON public.%I', relation);
    EXECUTE format('DROP POLICY IF EXISTS reference_update_admin ON public.%I', relation);
    EXECUTE format('DROP POLICY IF EXISTS reference_delete_admin ON public.%I', relation);
    EXECUTE format(
      'CREATE POLICY reference_insert_admin ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
       WITH CHECK ((SELECT client_monitor_private.current_role()) = ''admin'')', relation
    );
    EXECUTE format(
      'CREATE POLICY reference_update_admin ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
       USING ((SELECT client_monitor_private.current_role()) = ''admin'')
       WITH CHECK ((SELECT client_monitor_private.current_role()) = ''admin'')', relation
    );
    EXECUTE format(
      'CREATE POLICY reference_delete_admin ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated
       USING ((SELECT client_monitor_private.current_role()) = ''admin'')', relation
    );
  END LOOP;
END;
$$;

REVOKE ALL ON public.audit_log, public.client_project_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_log, public.client_project_history TO authenticated;
DROP POLICY IF EXISTS auth_audit_log ON public.audit_log;
DROP POLICY IF EXISTS audit_read_admin ON public.audit_log;
DROP POLICY IF EXISTS audit_require_admin ON public.audit_log;
CREATE POLICY audit_read_admin ON public.audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY audit_require_admin ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT client_monitor_private.current_role()) = 'admin');
DROP POLICY IF EXISTS authenticated_client_project_history ON public.client_project_history;
DROP POLICY IF EXISTS staff_project_history_read ON public.client_project_history;
CREATE POLICY staff_project_history_read ON public.client_project_history FOR SELECT TO authenticated USING (true);
REVOKE ALL ON SEQUENCE public.client_project_history_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_display_names()
RETURNS TABLE(username text, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    coalesce(raw_user_meta_data->>'username', split_part(email::text,'@',1)),
    raw_user_meta_data->>'full_name'
  FROM auth.users
  WHERE client_monitor_private.current_role() IN ('admin','user')
    AND raw_app_meta_data->>'role' IN ('admin','user')
    AND coalesce(raw_user_meta_data->>'full_name','') <> '';
$$;
REVOKE ALL ON FUNCTION public.get_display_names() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_display_names() TO authenticated;

CREATE OR REPLACE FUNCTION client_monitor_private.audit_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  row_data jsonb;
  changed_fields text;
  actor text := coalesce(auth.uid()::text, 'System');
  event_name text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT string_agg(field.key, ', ' ORDER BY field.key) INTO changed_fields
    FROM jsonb_each(to_jsonb(NEW)) AS field
    WHERE field.key <> 'updated_at' AND (to_jsonb(OLD)->field.key) IS DISTINCT FROM field.value;
    IF changed_fields IS NULL THEN
      RETURN NULL;
    END IF;
  END IF;

  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  event_name := CASE TG_OP WHEN 'INSERT' THEN 'Create' WHEN 'UPDATE' THEN 'Edit' ELSE 'Delete' END;
  INSERT INTO public.audit_log (ts, "user", action, target, detail)
  VALUES (statement_timestamp(), actor, event_name,
          TG_TABLE_NAME || ': ' || coalesce(row_data->>'id', row_data->>'name', ''),
          coalesce('Changed fields: ' || changed_fields, ''));

  IF TG_TABLE_NAME = 'client_projects' AND TG_OP = 'INSERT' THEN
    INSERT INTO public.client_project_history (project_id, action, user_name, detail)
    VALUES (NEW.id, 'Created', actor, '{"source":"Client Monitor"}'::jsonb);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION client_monitor_private.audit_changes() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['clients','implementors','modules','tasks','client_projects']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS client_monitor_audit ON public.%I', relation);
    EXECUTE format('CREATE TRIGGER client_monitor_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION client_monitor_private.audit_changes()', relation);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION client_monitor_private.clear_removed_reference()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'modules' THEN
    UPDATE public.clients AS client
    SET modules = (jsonb_populate_record(client, jsonb_build_object(
      'modules', to_jsonb(client.modules) - OLD.name
    ))).modules
    WHERE jsonb_typeof(to_jsonb(client.modules)) = 'array'
      AND to_jsonb(client.modules) ? OLD.name;
  ELSE
    UPDATE public.clients SET implementor = '' WHERE implementor = OLD.name;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION client_monitor_private.clear_removed_reference() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clear_removed_module ON public.modules;
CREATE TRIGGER clear_removed_module AFTER DELETE ON public.modules
  FOR EACH ROW EXECUTE FUNCTION client_monitor_private.clear_removed_reference();
DROP TRIGGER IF EXISTS clear_removed_implementor ON public.implementors;
CREATE TRIGGER clear_removed_implementor AFTER DELETE ON public.implementors
  FOR EACH ROW EXECUTE FUNCTION client_monitor_private.clear_removed_reference();

-- A unique claim per recipient and local reminder date prevents duplicate sends.
CREATE TABLE IF NOT EXISTS public.reminder_deliveries (
  reminder_date date NOT NULL,
  recipient text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  PRIMARY KEY (reminder_date, recipient)
);
ALTER TABLE public.reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reminder_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reminder_deliveries TO service_role;

-- The keep-alive workflow can run without reading any application tables.
CREATE OR REPLACE FUNCTION public.client_monitor_health()
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION public.client_monitor_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_monitor_health() TO anon;

NOTIFY pgrst, 'reload schema';
COMMIT;
