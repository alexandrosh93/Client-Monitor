-- ══════════════════════════════════════════════════════
-- RLS LOCKDOWN — Run in Supabase SQL Editor
-- Blocks all unauthenticated access to every data table.
-- Only logged-in users can read or write anything.
-- ══════════════════════════════════════════════════════

-- ── clients ─────────────────────────────────────────
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_clients        ON public.clients;
DROP POLICY IF EXISTS anon_read_clients   ON public.clients;
DROP POLICY IF EXISTS open_clients        ON public.clients;
DROP POLICY IF EXISTS auth_clients        ON public.clients;

CREATE POLICY auth_clients ON public.clients
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── audit_log ────────────────────────────────────────
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_audit_log      ON public.audit_log;
DROP POLICY IF EXISTS anon_read_audit_log ON public.audit_log;
DROP POLICY IF EXISTS open_audit_log      ON public.audit_log;
DROP POLICY IF EXISTS auth_audit_log      ON public.audit_log;

CREATE POLICY auth_audit_log ON public.audit_log
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── implementors ─────────────────────────────────────
ALTER TABLE public.implementors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_implementors      ON public.implementors;
DROP POLICY IF EXISTS anon_read_implementors ON public.implementors;
DROP POLICY IF EXISTS open_implementors      ON public.implementors;
DROP POLICY IF EXISTS auth_implementors      ON public.implementors;

CREATE POLICY auth_implementors ON public.implementors
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── modules ──────────────────────────────────────────
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_modules      ON public.modules;
DROP POLICY IF EXISTS anon_read_modules ON public.modules;
DROP POLICY IF EXISTS open_modules      ON public.modules;
DROP POLICY IF EXISTS auth_modules      ON public.modules;

CREATE POLICY auth_modules ON public.modules
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── Verify: list all policies after applying ─────────
SELECT
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
