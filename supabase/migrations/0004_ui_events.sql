-- =====================================================================
-- UI event log — one row per RPC call, so every live change can be pushed
-- to the UI (via a Supabase DB Webhook -> ui-push Edge Function -> Realtime).
-- Additive only; does not change any existing table or function.
-- =====================================================================
create table if not exists ui_events (
  id          bigint generated always as identity primary key,
  booking_ref text not null default 'anonymous',
  event_type  text not null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ui_events_ref on ui_events (booking_ref, created_at);

alter table ui_events enable row level security;
do $$ begin
  create policy ui_events_read on ui_events for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
