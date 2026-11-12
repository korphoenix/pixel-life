import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'
test('world transactions, ownership and generation quotas', async () => {
  const db = new PGlite()
  try {
    // Minimal Supabase auth/storage contracts; production uses Supabase's own schemas.
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
      grant usage on schema storage to authenticated;
      grant select,insert on storage.objects to authenticated;
      insert into auth.users values('${alice}'),('${bob}');
    `)
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated;')
    await db.exec(await readFile(new URL('../supabase/migrations/202611100001_world.sql', import.meta.url), 'utf8'))
    await db.exec(await readFile(new URL('../supabase/migrations/202611100002_security.sql', import.meta.url), 'utf8'))
    async function user(id) {
      await db.exec(`reset role; set role authenticated;`)
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
    }
    async function reserve(kind, revision, caption = '今天的小事') {
      return (await db.query('select public.reserve_generation($1,$2,$3,current_date) as id', [kind, revision, caption])).rows[0].id
    }
    async function finish(id, owner = alice) {
      const photo = `${owner}/${id}/photo.jpg`, image = `${owner}/${id}/world.png`
      await db.query('insert into storage.objects(bucket_id,name) values ($1,$2),($1,$3)', ['life-pixel', photo, image])
      await db.query('select public.finish_generation($1,$2,$3,$4)', [id, photo, image, { total_tokens: 123 }])
    }
    async function confirm(id) { return (await db.query('select public.confirm_generation($1) as revision', [id])).rows[0].revision }
    await user(alice)
    await assert.rejects(reserve('life', 0), /AVATAR_REQUIRED/)
    const avatar = await reserve('avatar', 0)
    await assert.rejects(confirm(avatar), /NOT_READY/)
    await finish(avatar)
    assert.equal((await db.query('select revision from public.worlds')).rows[0].revision, 0, 'candidate must not change world')
    assert.equal(await confirm(avatar), 1)
    assert.equal(await confirm(avatar), 1, 'confirmation retry must be idempotent')
    const first = await reserve('life', 1)
    const stale = await reserve('life', 1)
    await finish(first); await finish(stale)
    assert.equal(await confirm(first), 2)
    await assert.rejects(confirm(stale), /WORLD_CHANGED/)
    assert.equal((await db.query('select count(*)::int as n from public.entries')).rows[0].n, 2, 'conflict must not add history')
    assert.equal((await db.query('select status from public.generations where id=$1', [stale])).rows[0].status, 'ready')
    await assert.rejects(reserve('life', 1), /WORLD_CHANGED/)
    const third = await reserve('life', 2)
    await db.query('select public.fail_generation($1)', [third])
    await assert.rejects(reserve('life', 2), /DAILY_LIMIT/)
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['life-pixel', `${alice}/unreserved.png`]), /row-level security/)
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['life-pixel', `${alice}/${first}/extra.png`]), /row-level security/)
    await assert.rejects(db.query('update public.worlds set revision=100'), /permission denied/)
    await user(bob)
    for (const table of ['worlds','entries','generations']) {
      assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0, `${table} must isolate users`)
    }
    assert.equal((await db.query('select * from storage.objects')).rows.length, 0, 'private images must isolate users')
    await assert.rejects(confirm(first), /NOT_FOUND/)
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['life-pixel',`${alice}/attack.png`]), /row-level security/)
    const bobAvatar = await reserve('avatar', 0)
    await finish(bobAvatar, bob); assert.equal(await confirm(bobAvatar), 1)
    await db.exec('reset role; set role anon;')
    await assert.rejects(db.query('select * from public.entries'), /permission denied/)
    await assert.rejects(db.query('select public.confirm_generation($1)', [first]), /permission denied/)
  } finally { await db.close() }
})
