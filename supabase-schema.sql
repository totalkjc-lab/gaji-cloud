-- gaji-cloud schema: per-user folder + maps, RLS-only access control,
-- auto-provision trigger. Run once in the Supabase SQL editor.

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.maps (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.folders(id) on delete cascade,
  title text not null default '제목 없음',
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists maps_folder_id_idx on public.maps(folder_id);

alter table public.folders enable row level security;
alter table public.maps enable row level security;

-- folders: owner can always see their own; anyone (incl. anon) can see a public one
create policy "folders_select_own_or_public"
  on public.folders for select
  using (owner_id = auth.uid() or is_public = true);

-- folders: only the owner can flip is_public
create policy "folders_update_own"
  on public.folders for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- maps: readable if the parent folder is owned by the caller or is public
create policy "maps_select_via_folder"
  on public.maps for select
  using (
    exists (
      select 1 from public.folders f
      where f.id = maps.folder_id
        and (f.owner_id = auth.uid() or f.is_public = true)
    )
  );

-- maps: writable (insert/update/delete) only if the parent folder is owned by the caller
create policy "maps_write_own_folder"
  on public.maps for all
  using (
    exists (select 1 from public.folders f where f.id = maps.folder_id and f.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.folders f where f.id = maps.folder_id and f.owner_id = auth.uid())
  );

-- auto-provision exactly one folder per new user, at the source (not in client code)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.folders (owner_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- backfill: provision folders for any user who signed in before this schema
-- was run (the trigger above only fires for new signups). Idempotent, so
-- running this script multiple times / in any order is always safe.
insert into public.folders (owner_id) select id from auth.users
  on conflict (owner_id) do nothing;
