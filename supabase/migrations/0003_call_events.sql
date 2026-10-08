-- =====================================================================
-- Webhook event log for the live UI (right-panel transcript + events).
-- Additive only — does NOT change flights/seats/bookings/customers/pricing
-- or any existing function. Safe to run on the live project.
-- =====================================================================

create table if not exists call_events (
  event_id          bigint generated always as identity primary key,
  call_id           text,
  booking_reference text,
  event_type        text,            -- e.g. transcript / tool_call / call_started / call_ended
  role              text,            -- agent / customer / system
  text              text,            -- transcript line / message
  payload           jsonb,           -- full raw event from the source
  created_at        timestamptz not null default now()
);
create index if not exists idx_call_events_call   on call_events (call_id, created_at);
create index if not exists idx_call_events_ref    on call_events (booking_reference, created_at);

-- RLS: UI (anon) may READ events; writes come from the webhook using the
-- service-role key (which bypasses RLS). No anon writes.
alter table call_events enable row level security;

do $$ begin
  create policy call_events_read on call_events for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;

-- Add to the Realtime publication so the UI can subscribe to live inserts.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_events'
  ) then
    alter publication supabase_realtime add table call_events;
  end if;
end $$;
