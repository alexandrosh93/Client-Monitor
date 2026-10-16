-- Tasks per client (project monitoring MVP). Run once in the Supabase SQL Editor.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id bigint REFERENCES public.clients(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  assignee text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'To do' CHECK (status IN ('To do','In progress','Blocked','Done')),
  priority text NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low','Normal','High','Urgent')),
  due_date date,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS tasks_client_idx ON public.tasks(client_id);
CREATE INDEX IF NOT EXISTS tasks_assignee_status_idx ON public.tasks(assignee, status);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_tasks ON public.tasks;
CREATE POLICY authenticated_tasks ON public.tasks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Existing installs: allow general tasks that don't belong to a client.
ALTER TABLE public.tasks ALTER COLUMN client_id DROP NOT NULL;
