-- Run once in Supabase SQL Editor. All images are private.
create table public.worlds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  avatar_path text,
  current_image_path text,
  updated_at timestamptz not null default now()
);
create table public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('avatar', 'life')),
  base_revision integer not null,
  status text not null default 'reserved' check (status in ('reserved','ready','committed','failed')),
  caption text not null default '' check (length(caption) <= 300),
  occurred_on date not null,
  photo_path text,
  image_path text,
  usage jsonb,
  created_at timestamptz not null default now()
);
create index generations_owner_date on public.generations(user_id, created_at desc);
create table public.entries (
  id uuid primary key references public.generations(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('avatar','life')),
  revision integer not null,
  caption text not null,
  occurred_on date not null,
  photo_path text not null,
  image_path text not null,
  created_at timestamptz not null default now(),
  unique(user_id, revision)
);
create index entries_owner_date on public.entries(user_id, created_at desc);
alter table public.worlds enable row level security;
alter table public.generations enable row level security;
alter table public.entries enable row level security;
create policy own_world on public.worlds for select to authenticated using (user_id = (select auth.uid()));
create policy own_generations on public.generations for select to authenticated using (user_id = (select auth.uid()));
create policy own_entries on public.entries for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.worlds, public.generations, public.entries from anon, authenticated;
grant select on public.worlds, public.generations, public.entries to authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('life-pixel','life-pixel',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy own_pixel_read on storage.objects for select to authenticated
using (bucket_id='life-pixel' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy own_pixel_insert on storage.objects for insert to authenticated
with check (
  bucket_id='life-pixel' and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists (
    select 1 from public.generations g
    where g.user_id=(select auth.uid()) and g.status='reserved'
      and name in (g.user_id::text||'/'||g.id::text||'/photo.jpg',
                   g.user_id::text||'/'||g.id::text||'/photo.png',
                   g.user_id::text||'/'||g.id::text||'/photo.webp',
                   g.user_id::text||'/'||g.id::text||'/world.png')
  )
);
-- No overwrite or delete policy: confirmed history remains immutable through the app.

create function public.reserve_generation(p_kind text, p_revision integer, p_caption text, p_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); w public.worlds; result_id uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_kind not in ('avatar','life') or p_kind is null or p_date is null or p_caption is null or length(p_caption)>300 then raise exception 'INVALID_INPUT'; end if;
  insert into public.worlds(user_id) values(u) on conflict do nothing;
  select * into w from public.worlds where user_id=u for update;
  if p_revision is distinct from w.revision then raise exception 'WORLD_CHANGED' using errcode='40001'; end if;
  if p_kind='life' and w.avatar_path is null then raise exception 'AVATAR_REQUIRED'; end if;
  -- Count attempts, including failed/uncertain requests, to avoid accidental repeated charges.
  if (select count(*) from public.generations where user_id=u and kind=p_kind
      and created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')
      >= (case when p_kind='life' then 3 else 5 end) then raise exception 'DAILY_LIMIT'; end if;
  insert into public.generations(user_id,kind,base_revision,caption,occurred_on)
  values(u,p_kind,p_revision,p_caption,p_date) returning id into result_id;
  return result_id;
end $$;

create function public.finish_generation(p_id uuid, p_photo text, p_image text, p_usage jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_photo is null or p_image is null or p_photo not in (u::text||'/'||p_id::text||'/photo.jpg', u::text||'/'||p_id::text||'/photo.png', u::text||'/'||p_id::text||'/photo.webp') or p_image <> u::text||'/'||p_id::text||'/world.png' then raise exception 'INVALID_PATH'; end if;
  if p_usage is not null and (jsonb_typeof(p_usage)<>'object' or pg_column_size(p_usage)>4096) then raise exception 'INVALID_USAGE'; end if;
  if not exists(select 1 from storage.objects where bucket_id='life-pixel' and name=p_photo)
     or not exists(select 1 from storage.objects where bucket_id='life-pixel' and name=p_image) then raise exception 'MISSING_IMAGE'; end if;
  update public.generations set status='ready',photo_path=p_photo,image_path=p_image,usage=p_usage
  where id=p_id and user_id=u and status='reserved';
  if not found then raise exception 'INVALID_GENERATION'; end if;
end $$;

create function public.fail_generation(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.generations set status='failed' where id=p_id and user_id=auth.uid() and status='reserved';
end $$;

create function public.confirm_generation(p_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); g public.generations; w public.worlds; new_revision integer;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into g from public.generations where id=p_id and user_id=u for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- Retrying a confirmation is free and idempotent, including after a lost response.
  if g.status='committed' then return (select revision from public.entries where id=p_id); end if;
  if g.status<>'ready' then raise exception 'NOT_READY'; end if;
  select * into w from public.worlds where user_id=u for update;
  if w.revision is distinct from g.base_revision then raise exception 'WORLD_CHANGED' using errcode='40001'; end if;
  new_revision := w.revision+1;
  insert into public.entries(id,user_id,kind,revision,caption,occurred_on,photo_path,image_path)
  values(g.id,u,g.kind,new_revision,g.caption,g.occurred_on,g.photo_path,g.image_path);
  update public.worlds set revision=new_revision,
    avatar_path=case when g.kind='avatar' then g.image_path else avatar_path end,
    current_image_path=g.image_path,updated_at=now() where user_id=u;
  update public.generations set status='committed' where id=p_id;
  return new_revision;
end $$;

revoke all on function public.reserve_generation(text,integer,text,date) from public, anon, authenticated;
revoke all on function public.finish_generation(uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.fail_generation(uuid) from public, anon, authenticated;
revoke all on function public.confirm_generation(uuid) from public, anon, authenticated;
grant execute on function public.reserve_generation(text,integer,text,date) to authenticated;
grant execute on function public.finish_generation(uuid,text,text,jsonb) to authenticated;
grant execute on function public.fail_generation(uuid) to authenticated;
grant execute on function public.confirm_generation(uuid) to authenticated;
