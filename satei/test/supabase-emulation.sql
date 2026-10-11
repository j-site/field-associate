-- テスト専用：Supabase の権限まわりを素の PostgreSQL で再現する。
-- 本番の Supabase では不要（すでに存在する）。

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  created_at timestamptz not null default now()
);

-- Supabase と同じ定義：JWT の sub をユーザーIDとして返す
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$$;

grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- Supabase は public スキーマの新しいテーブル・関数を anon/authenticated に既定で開放する。
-- schema.sql がこの既定を正しく打ち消せているかを試すため、同じ状態を作っておく
alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
