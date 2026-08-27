create extension if not exists pgcrypto;

create table if not exists public.timeline_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.timeline_memories (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  show text not null check (length(trim(show)) > 0),
  theatre text,
  city text,
  seat text,
  price text,
  rating numeric check (rating between 1 and 5),
  cast_vibe text check (
    cast_vibe is null or case when upper(cast_vibe) = 'NA' then true
    when cast_vibe ~ '^[1-5](\.[0-9]+)?$' then cast_vibe::numeric between 1 and 5 else false end
  ),
  music_vibe text check (
    music_vibe is null or case when upper(music_vibe) = 'NA' then true
    when music_vibe ~ '^[1-5](\.[0-9]+)?$' then music_vibe::numeric between 1 and 5 else false end
  ),
  stage_magic text check (
    stage_magic is null or case when upper(stage_magic) = 'NA' then true
    when stage_magic ~ '^[1-5](\.[0-9]+)?$' then stage_magic::numeric between 1 and 5 else false end
  ),
  story_feel text check (
    story_feel is null or case when upper(story_feel) = 'NA' then true
    when story_feel ~ '^[1-5](\.[0-9]+)?$' then story_feel::numeric between 1 and 5 else false end
  ),
  note text,
  photo text,
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  source_photos text,
  confidence text,
  source_receipts text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.timeline_memories
add column if not exists price text;

create or replace function public.set_timeline_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists timeline_memories_updated_at on public.timeline_memories;
create trigger timeline_memories_updated_at
before update on public.timeline_memories
for each row execute function public.set_timeline_updated_at();

alter table public.timeline_memories enable row level security;
alter table public.timeline_admins enable row level security;

create or replace function public.is_timeline_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.timeline_admins
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_timeline_admin() from public;
grant execute on function public.is_timeline_admin() to authenticated;

drop policy if exists "Timeline memories are publicly readable" on public.timeline_memories;
create policy "Timeline memories are publicly readable"
on public.timeline_memories for select
to anon, authenticated
using (true);

drop policy if exists "Authenticated admins can add memories" on public.timeline_memories;
create policy "Authenticated admins can add memories"
on public.timeline_memories for insert
to authenticated
with check (public.is_timeline_admin());

drop policy if exists "Authenticated admins can update memories" on public.timeline_memories;
create policy "Authenticated admins can update memories"
on public.timeline_memories for update
to authenticated
using (public.is_timeline_admin())
with check (public.is_timeline_admin());

drop policy if exists "Authenticated admins can delete memories" on public.timeline_memories;
create policy "Authenticated admins can delete memories"
on public.timeline_memories for delete
to authenticated
using (public.is_timeline_admin());

grant select on public.timeline_memories to anon;
grant select, insert, update, delete on public.timeline_memories to authenticated;

-- After creating your administrator in Authentication > Users, run this once:
-- insert into public.timeline_admins (user_id)
-- select id from auth.users where email = 'YOUR_ADMIN_EMAIL';
