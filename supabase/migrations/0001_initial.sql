create extension if not exists pgcrypto;

create table if not exists public.rooms (
  room_code text primary key,
  host_member_id text not null,
  max_players integer not null default 4 check (max_players between 2 and 4),
  phase text not null default 'lobby',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.room_members (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.rooms(room_code) on delete cascade,
  player_id text not null,
  client_id text not null,
  display_name text not null,
  seat integer not null default 0,
  is_host boolean not null default false,
  is_connected boolean not null default true,
  ready boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_code, seat),
  unique (room_code, client_id),
  unique (room_code, player_id)
);

create table if not exists public.games (
  room_code text primary key references public.rooms(room_code) on delete cascade,
  state jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_actions (
  id uuid primary key default gen_random_uuid(),
  game_id text not null,
  player_id text,
  action_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  hit_count integer not null default 0,
  reset_at timestamptz not null default now()
);

create or replace function public.consume_rate_limit(
  bucket_key text,
  max_hits integer,
  window_ms integer
)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_reset timestamptz;
  current_count integer;
  window_interval interval := make_interval(secs => window_ms / 1000.0);
begin
  loop
    select hit_count, rate_limit_buckets.reset_at
      into current_count, current_reset
      from public.rate_limit_buckets
      where rate_limit_buckets.bucket_key = consume_rate_limit.bucket_key
      for update;

    if not found then
      insert into public.rate_limit_buckets(bucket_key, hit_count, reset_at)
      values (consume_rate_limit.bucket_key, 1, now() + window_interval)
      on conflict (bucket_key) do nothing;

      allowed := true;
      remaining := max_hits - 1;
      reset_at := now() + window_interval;
      return next;
      return;
    end if;

    if current_reset <= now() then
      update public.rate_limit_buckets
      set hit_count = 1,
          reset_at = now() + window_interval
      where public.rate_limit_buckets.bucket_key = consume_rate_limit.bucket_key;

      allowed := true;
      remaining := max_hits - 1;
      reset_at := now() + window_interval;
      return next;
      return;
    end if;

    if current_count >= max_hits then
      allowed := false;
      remaining := 0;
      reset_at := current_reset;
      return next;
      return;
    end if;

    update public.rate_limit_buckets
    set hit_count = current_count + 1
    where public.rate_limit_buckets.bucket_key = consume_rate_limit.bucket_key;

    allowed := true;
    remaining := max_hits - current_count - 1;
    reset_at := current_reset;
    return next;
    return;
  end loop;
end;
$$;

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.games enable row level security;
alter table public.game_actions enable row level security;

create policy "room members can read rooms"
on public.rooms
for select
using (
  exists (
    select 1
    from public.room_members member
    where member.room_code = rooms.room_code
      and member.client_id = auth.uid()::text
  )
);

create policy "room members can read room members"
on public.room_members
for select
using (
  exists (
    select 1
    from public.room_members viewer
    where viewer.room_code = room_members.room_code
      and viewer.client_id = auth.uid()::text
  )
);

create policy "room members can read games"
on public.games
for select
using (
  exists (
    select 1
    from public.room_members member
    where member.room_code = games.room_code
      and member.client_id = auth.uid()::text
  )
);

create policy "room members can read actions"
on public.game_actions
for select
using (
  exists (
    select 1
    from public.room_members member
    where member.room_code = game_actions.game_id
      and member.client_id = auth.uid()::text
  )
);
