-- Adds a "next follow-up date" field to clients, used by the
-- Due Today / Overdue Follow-ups widget on the home dashboard.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS next_followup_date date;
