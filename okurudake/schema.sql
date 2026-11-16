-- 任意：利用の記録を Supabase に保存する場合に、SQL Editor で実行する
create table if not exists public.okuru_events (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  kind       text not null check (kind in ('usage', 'pack_proposal')),
  pack       text,
  user_hash  text not null,
  detail     text
);
alter table public.okuru_events enable row level security;   -- 方針なし＝サーバーの鍵以外からは読めない
revoke all on public.okuru_events from anon, authenticated;

-- パックごとの月別の利用回数と利用者数（作者への分配の元になる）
create or replace view public.okuru_pack_usage
with (security_invoker = true) as
select date_trunc('month', ts)::date as month, pack, count(*) as uses, count(distinct user_hash) as users
from public.okuru_events
where kind = 'usage'
group by 1, 2
order by 1 desc, 3 desc;
revoke all on public.okuru_pack_usage from anon, authenticated;
