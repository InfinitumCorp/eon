-- E(O)N™ MIL backend tables in the shared Infinitum Corp project.
--
-- What lives here: who is cleared as team lead, and a record of each finished
-- exercise run (when, how many ticks, the ledger head hash and whether it
-- verified). What does NOT live here: the exercise itself. Detections, fixes,
-- engagements, the action log and the signed ledger stay in the Cloudflare
-- Durable Object, so no MIL picture data enters the shared project.
--
-- Only the Worker reads and writes these tables, with the service-role key held
-- in a Cloudflare Worker secret. Row-level security is on with no policies, so
-- the anon and authenticated roles see nothing.

create schema if not exists eon;

revoke all on schema eon from public, anon, authenticated;
grant usage on schema eon to service_role;

create table eon.team_leads (
  email text primary key
    check (email = lower(email) and position('@' in email) > 1 and length(email) <= 254),
  active boolean not null default true,
  note text check (length(note) <= 280),
  added_at timestamptz not null default now()
);

comment on table eon.team_leads is
  'Signed-in emails (Cloudflare Access) cleared to act as E(O)N team lead. Everyone else who signs in is an operator.';

create table eon.exercise_runs (
  id bigint generated always as identity primary key,
  exercise text not null check (length(exercise) <= 64),
  started_at timestamptz,
  ended_at timestamptz not null default now(),
  reason text not null check (reason in ('reset', 'limit')),
  ticks integer not null check (ticks >= 0),
  ledger_length integer not null check (ledger_length >= 0),
  ledger_head text not null check (ledger_head ~ '^[0-9a-f]{64}$'),
  ledger_ok boolean not null,
  ended_by text check (length(ended_by) <= 254)
);

comment on table eon.exercise_runs is
  'One row per finished exercise run: timing, tick count and ledger head hash only. No picture data.';

create index exercise_runs_ended_at_idx on eon.exercise_runs (ended_at desc);

alter table eon.team_leads enable row level security;
alter table eon.exercise_runs enable row level security;
-- No policies on purpose: anon and authenticated get no rows. service_role bypasses RLS.

revoke all on all tables in schema eon from public, anon, authenticated;
revoke all on all sequences in schema eon from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema eon to service_role;
grant usage, select on all sequences in schema eon to service_role;

alter default privileges in schema eon revoke all on tables from public, anon, authenticated;
alter default privileges in schema eon revoke all on sequences from public, anon, authenticated;

-- Same team lead the Worker's TEAM_LEADS variable names today.
insert into eon.team_leads (email, note)
values ('theinfinitumcorp@gmail.com', 'Seeded from TEAM_LEADS in wrangler.toml')
on conflict (email) do nothing;
