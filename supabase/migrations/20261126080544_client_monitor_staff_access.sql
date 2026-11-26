-- Keep the shared staff workspace, with its existing command-specific policies.
-- A restrictive policy adds the staff check to all existing permissive policies.
do $$
declare
  staff_table text;
begin
  foreach staff_table in array array[
    'audit_log', 'client_project_history', 'client_projects', 'clients',
    'implementors', 'modules', 'tasks'
  ] loop
    execute format($policy$
      create policy client_monitor_staff_only on public.%I
        as restrictive for all to authenticated
        using ((select (auth.jwt()->'app_metadata'->>'role') in ('user', 'admin')
                       and coalesce(auth.jwt()->>'is_anonymous', 'false') = 'false'))
        with check ((select (auth.jwt()->'app_metadata'->>'role') in ('user', 'admin')
                            and coalesce(auth.jwt()->>'is_anonymous', 'false') = 'false'))
    $policy$, staff_table);
  end loop;
end
$$;

-- The username-to-email lookup still supports the signed-out login form.
-- The staff directory is only used after a successful staff sign-in.
create schema if not exists client_monitor_private;
revoke all on schema client_monitor_private from public, anon;
grant usage on schema client_monitor_private to authenticated;

create function client_monitor_private.get_display_names()
returns table(username text, full_name text)
language sql
security definer
set search_path = ''
as $$
  select coalesce(raw_user_meta_data->>'username', split_part(email::text, '@', 1)),
         coalesce(raw_user_meta_data->>'full_name', '')
  from auth.users
  where coalesce(raw_user_meta_data->>'full_name', '') <> ''
    and (select auth.uid()) is not null
    and (select (auth.jwt()->'app_metadata'->>'role') in ('user', 'admin')
                  and coalesce(auth.jwt()->>'is_anonymous', 'false') = 'false');
$$;

revoke execute on function client_monitor_private.get_display_names() from public, anon;
grant execute on function client_monitor_private.get_display_names() to authenticated;

create or replace function public.get_display_names()
returns table(username text, full_name text)
language sql
security invoker
set search_path = ''
as $$
  select * from client_monitor_private.get_display_names();
$$;

revoke execute on function public.get_display_names() from public, anon;
grant execute on function public.get_display_names() to authenticated;

-- The admin-users Edge Function is the supported entry point. It verifies the
-- caller with Auth and checks their server-managed app_metadata role.
revoke execute on function
  public.admin_create_user(text, text, text, text, text),
  public.admin_delete_user(uuid),
  public.admin_list_users(),
  public.admin_set_password(uuid, text),
  public.admin_update_email(uuid, text),
  public.admin_update_user(uuid, text, text, text, text)
from public, anon, authenticated;
