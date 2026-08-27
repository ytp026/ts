create extension if not exists pgcrypto;

create table if not exists public.timeline_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table public.timeline_memories (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  show text not null check (length(trim(show)) > 0),
  theatre text,
  city text,
  seat text,
  rating numeric check (rating between 1 and 5),
  cast_vibe text,
  music_vibe text,
  stage_magic text,
  story_feel text,
  price text,
  note text,
  photo text,
  color text,
  source_photos text,
  confidence text,
  source_receipts text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create policy "Timeline memories are publicly readable"
on public.timeline_memories for select
to anon, authenticated
using (true);

create policy "Authenticated admins can add memories"
on public.timeline_memories for insert
to authenticated
with check (public.is_timeline_admin());

create policy "Authenticated admins can update memories"
on public.timeline_memories for update
to authenticated
using (public.is_timeline_admin())
with check (public.is_timeline_admin());

create policy "Authenticated admins can delete memories"
on public.timeline_memories for delete
to authenticated
using (public.is_timeline_admin());

grant select on public.timeline_memories to anon;
grant select, insert, update, delete on public.timeline_memories to authenticated;

insert into public.timeline_admins (user_id)
values ('677be953-0334-498c-b134-03369660463a')
on conflict (user_id) do nothing;
