-- ============================================================
--  JarvisRide — Supabase スキーマ
--  Supabase ダッシュボードの SQL Editor に貼り付けて実行してください。
--  事前に Authentication → Providers → Anonymous sign-ins を有効化します。
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 配車テーブル
-- ------------------------------------------------------------
create table if not exists public.rides (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  status      text not null default 'searching'
              check (status in ('searching','enroute','arrived','onboard','completed','cancelled')),
  cls         text not null check (cls in ('robotaxi','standard','premium')),

  pickup      jsonb  not null,   -- {lat, lng, label}
  dest        jsonb  not null,   -- {lat, lng, label}
  car         jsonb,             -- {lat, lng}  車両の現在位置
  driver      jsonb,             -- {name, car, plate, rating, autonomous, human}

  km          numeric(7,2) not null,
  base        numeric(9,0) not null,
  pickup_fee  numeric(9,0) not null default 0,
  total       numeric(9,0) not null,
  eta         integer not null default 0,

  rider_id    uuid not null references auth.users(id) on delete cascade,
  driver_id   uuid references auth.users(id) on delete set null
);

create index if not exists rides_open_idx    on public.rides (status, created_at desc);
create index if not exists rides_rider_idx   on public.rides (rider_id);
create index if not exists rides_driver_idx  on public.rides (driver_id);

-- updated_at を自動更新
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists rides_touch on public.rides;
create trigger rides_touch before update on public.rides
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 行レベルセキュリティ
-- ------------------------------------------------------------
alter table public.rides enable row level security;

drop policy if exists rides_select on public.rides;
drop policy if exists rides_insert on public.rides;
drop policy if exists rides_update_rider on public.rides;
drop policy if exists rides_update_driver on public.rides;
drop policy if exists rides_claim on public.rides;

-- 参照：自分が乗客／担当ドライバーの配車、または受付中のリクエスト（30分以内）
create policy rides_select on public.rides
  for select to authenticated
  using (
    rider_id = auth.uid()
    or driver_id = auth.uid()
    or (status = 'searching' and created_at > now() - interval '30 minutes')
  );

-- 作成：自分名義の受付中リクエストのみ
create policy rides_insert on public.rides
  for insert to authenticated
  with check (rider_id = auth.uid() and driver_id is null and status = 'searching');

-- 更新：乗客本人
create policy rides_update_rider on public.rides
  for update to authenticated
  using (rider_id = auth.uid())
  with check (rider_id = auth.uid());

-- 更新：担当ドライバー
create policy rides_update_driver on public.rides
  for update to authenticated
  using (driver_id = auth.uid())
  with check (driver_id = auth.uid());

-- 受諾：未割当の受付中リクエストを自分に割り当てる
-- （同一条件の UPDATE が同時に来ても、行ロックにより先着1件のみ成功する）
create policy rides_claim on public.rides
  for update to authenticated
  using (status = 'searching' and driver_id is null)
  with check (driver_id = auth.uid());

-- ------------------------------------------------------------
-- Realtime（変更を各端末へ配信）
-- ------------------------------------------------------------
alter table public.rides replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.rides;
exception
  when duplicate_object then null;
end $$;
