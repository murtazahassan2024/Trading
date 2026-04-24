create table if not exists public.signalos_state (
  device_id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.signalos_state enable row level security;

drop policy if exists "anon can read signalos state" on public.signalos_state;
create policy "anon can read signalos state"
on public.signalos_state
for select
to anon
using (true);

drop policy if exists "anon can upsert signalos state" on public.signalos_state;
create policy "anon can upsert signalos state"
on public.signalos_state
for insert
to anon
with check (true);

drop policy if exists "anon can update signalos state" on public.signalos_state;
create policy "anon can update signalos state"
on public.signalos_state
for update
to anon
using (true)
with check (true);

create table if not exists public.signalos_alerts (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  trade_id text,
  symbol text,
  side text,
  kind text not null default 'trade',
  status text not null default 'open',
  icon text,
  color text,
  message text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists signalos_alerts_device_created_idx
on public.signalos_alerts (device_id, created_at desc);

alter table public.signalos_alerts enable row level security;

drop policy if exists "anon can read signalos alerts" on public.signalos_alerts;
create policy "anon can read signalos alerts"
on public.signalos_alerts
for select
to anon
using (true);

drop policy if exists "anon can insert signalos alerts" on public.signalos_alerts;
create policy "anon can insert signalos alerts"
on public.signalos_alerts
for insert
to anon
with check (true);

drop policy if exists "anon can update signalos alerts" on public.signalos_alerts;
create policy "anon can update signalos alerts"
on public.signalos_alerts
for update
to anon
using (true)
with check (true);

drop policy if exists "anon can delete signalos alerts" on public.signalos_alerts;
create policy "anon can delete signalos alerts"
on public.signalos_alerts
for delete
to anon
using (true);
