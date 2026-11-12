-- Apply after 202611100001_world.sql if it was already installed.
begin;
update storage.buckets set public=false where id='life-pixel';
drop policy if exists own_pixel_insert on storage.objects;
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
create or replace function public.finish_generation(p_id uuid, p_photo text, p_image text, p_usage jsonb)
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

revoke all on function public.reserve_generation(text,integer,text,date) from public, anon, authenticated;
revoke all on function public.finish_generation(uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.fail_generation(uuid) from public, anon, authenticated;
revoke all on function public.confirm_generation(uuid) from public, anon, authenticated;
grant execute on function public.reserve_generation(text,integer,text,date) to authenticated;
grant execute on function public.finish_generation(uuid,text,text,jsonb) to authenticated;
grant execute on function public.fail_generation(uuid) to authenticated;
grant execute on function public.confirm_generation(uuid) to authenticated;

commit;
