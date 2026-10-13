-- Store the external Client ID found on Software Order forms.
alter table public.clients
  add column if not exists client_code text;

alter table public.clients
  drop constraint if exists clients_client_code_length;

alter table public.clients
  add constraint clients_client_code_length
  check (client_code is null or char_length(client_code) <= 100);
