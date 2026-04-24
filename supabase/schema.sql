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
