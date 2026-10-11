-- ============================================================
--  不動産査定マッチング — Supabase スキーマ
--
--  Supabase の SQL Editor に貼り付けて実行する。
--
--  設計方針
--   * テーブルには直接触らせない。すべての読み書きは下の関数（RPC）経由にし、
--     関数の中で「誰が・何を見てよいか」を判定する。
--   * 連絡先（氏名・電話・メール・番地）は別テーブルに分け、
--     その査定依頼を購入した不動産会社にしか返さない。
--   * 購入前のプレビューは市区町村まで。面積・築年数も幅で丸める
--     （町名＋面積＋築年数の組み合わせで家が特定できてしまうため）。
--   * purchases テーブルが、個人情報保護法の「第三者提供の記録」を兼ねる
--     （いつ・どの事業者に・誰の情報を提供したか）。
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 運営設定（1行だけ）
-- ------------------------------------------------------------
create table if not exists public.settings (
  id              int primary key default 1 check (id = 1),
  lead_price      int  not null default 1 check (lead_price > 0),   -- 1件あたりの消費クレジット
  max_buyers      int  not null default 3 check (max_buyers between 1 and 10),
  lead_ttl_days   int  not null default 30 check (lead_ttl_days > 0),
  consent_version text not null default '2026-10-11'
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 査定依頼（物件情報）
-- ------------------------------------------------------------
create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  property_type   text not null check (property_type in ('mansion','house','land','apartment','other')),
  prefecture      text not null check (char_length(prefecture) between 2 and 4),
  city            text not null check (char_length(city) between 1 and 40),
  town            text check (char_length(town) <= 60),
  land_area       numeric(10,2) check (land_area > 0 and land_area < 1000000),
  building_area   numeric(10,2) check (building_area > 0 and building_area < 1000000),
  built_year      int check (built_year between 1900 and 2100),
  layout          text check (char_length(layout) <= 20),
  current_status  text check (current_status in ('living','vacant','rented','other')),
  sale_timing     text not null check (sale_timing in ('asap','3m','6m','1y','undecided')),
  reason          text check (char_length(reason) <= 500),
  max_buyers      int  not null,
  buyer_count     int  not null default 0,
  status          text not null default 'open' check (status in ('open','closed','withdrawn')),
  consent_version text not null,
  consented_at    timestamptz not null,
  check (buyer_count between 0 and max_buyers)
);
create index if not exists leads_open_idx on public.leads (status, created_at desc);

-- 連絡先（購入した不動産会社にだけ開示する部分）
create table if not exists public.lead_contacts (
  lead_id         uuid primary key references public.leads(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 60),
  phone           text check (phone ~ '^[0-9+\-() ]{10,20}$'),
  email           text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200),
  address_detail  text check (char_length(address_detail) <= 120),  -- 番地・建物名・部屋番号
  contact_method  text check (contact_method in ('phone','email','either')),
  contact_time    text check (char_length(contact_time) <= 60),
  note            text check (char_length(note) <= 1000),
  check (phone is not null or email is not null)
);

-- ------------------------------------------------------------
-- 提携不動産会社
-- ------------------------------------------------------------
create table if not exists public.partners (
  id              uuid primary key references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  company_name    text not null check (char_length(company_name) between 1 and 100),
  license_no      text not null check (char_length(license_no) between 5 and 60), -- 宅地建物取引業 免許番号
  representative  text not null check (char_length(representative) between 1 and 60),
  phone           text not null check (phone ~ '^[0-9+\-() ]{10,20}$'),
  email           text,
  areas           text[] not null default '{}',   -- 対応する都道府県（空なら全国）
  approved        boolean not null default false,
  credits         int not null default 0 check (credits >= 0)
);

create table if not exists public.admins (
  user_id         uuid primary key references auth.users(id) on delete cascade
);

-- 購入履歴 = 第三者提供の記録
create table if not exists public.purchases (
  id              bigserial primary key,
  lead_id         uuid not null references public.leads(id) on delete restrict,
  partner_id      uuid not null references public.partners(id) on delete restrict,
  price           int  not null,
  purchased_at    timestamptz not null default now(),
  unique (lead_id, partner_id)
);

-- クレジットの増減履歴（入金・消費・調整）
create table if not exists public.credit_ledger (
  id              bigserial primary key,
  partner_id      uuid not null references public.partners(id) on delete cascade,
  amount          int  not null,
  reason          text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid
);

-- ------------------------------------------------------------
-- 直接アクセスを全面禁止（関数経由のみ）
-- ------------------------------------------------------------
alter table public.settings      enable row level security;
alter table public.leads         enable row level security;
alter table public.lead_contacts enable row level security;
alter table public.partners      enable row level security;
alter table public.admins        enable row level security;
alter table public.purchases     enable row level security;
alter table public.credit_ledger enable row level security;
-- ポリシーを1つも作らない＝RLSにより匿名・ログインユーザーとも行が見えない。
-- 念のため権限そのものも外す（Supabaseは既定で anon/authenticated に付与するため）
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ------------------------------------------------------------
-- 共通の判定
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- 面積を幅で丸める（購入前プレビュー用）
create or replace function public.area_band(a numeric)
returns text language sql immutable as $$
  select case
    when a is null then null
    when a < 40  then '40㎡未満'
    when a < 60  then '40〜60㎡'
    when a < 80  then '60〜80㎡'
    when a < 100 then '80〜100㎡'
    when a < 150 then '100〜150㎡'
    when a < 200 then '150〜200㎡'
    when a < 300 then '200〜300㎡'
    else '300㎡以上' end;
$$;

-- 公開しても個人を特定できない形の物件情報
create or replace function public.lead_preview(l public.leads)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', l.id,
    'created_at', l.created_at,
    'property_type', l.property_type,
    'prefecture', l.prefecture,
    'city', l.city,
    'land_area_band', public.area_band(l.land_area),
    'building_area_band', public.area_band(l.building_area),
    'built_decade', case when l.built_year is null then null else (l.built_year / 10 * 10)::text || '年代' end,
    'layout', l.layout,
    'current_status', l.current_status,
    'sale_timing', l.sale_timing,
    'buyer_count', l.buyer_count,
    'max_buyers', l.max_buyers
  );
$$;

-- 購入後に開示する全情報
create or replace function public.lead_full(l public.leads, c public.lead_contacts)
returns jsonb language sql stable as $$
  select to_jsonb(l) - 'consent_version'
    || jsonb_build_object('contact', to_jsonb(c) - 'lead_id');
$$;

-- ------------------------------------------------------------
-- 一般の方：査定依頼の送信
-- ------------------------------------------------------------
create or replace function public.submit_lead(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.settings;
  new_id uuid;
begin
  -- ボット対策の見えない入力欄。人間は入力しないので、値があれば保存せず成功を装う
  if coalesce(p->>'website', '') <> '' then
    return jsonb_build_object('ok', true);
  end if;

  if coalesce((p->>'consent')::boolean, false) is not true then
    raise exception '提携不動産会社への情報提供に同意いただく必要があります' using errcode = '22023';
  end if;
  if nullif(trim(p->>'phone'), '') is null and nullif(trim(p->>'email'), '') is null then
    raise exception '電話番号かメールアドレスのどちらかを入力してください' using errcode = '22023';
  end if;

  select * into s from public.settings where id = 1;

  insert into public.leads (
    property_type, prefecture, city, town, land_area, building_area, built_year,
    layout, current_status, sale_timing, reason,
    max_buyers, consent_version, consented_at
  ) values (
    p->>'property_type', trim(p->>'prefecture'), trim(p->>'city'), nullif(trim(p->>'town'), ''),
    nullif(p->>'land_area', '')::numeric, nullif(p->>'building_area', '')::numeric,
    nullif(p->>'built_year', '')::int,
    nullif(trim(p->>'layout'), ''), nullif(p->>'current_status', ''), p->>'sale_timing',
    nullif(trim(p->>'reason'), ''),
    s.max_buyers, s.consent_version, now()
  ) returning id into new_id;

  insert into public.lead_contacts (
    lead_id, name, phone, email, address_detail, contact_method, contact_time, note
  ) values (
    new_id, trim(p->>'name'), nullif(trim(p->>'phone'), ''), nullif(lower(trim(p->>'email')), ''),
    nullif(trim(p->>'address_detail'), ''), coalesce(nullif(p->>'contact_method', ''), 'either'),
    nullif(trim(p->>'contact_time'), ''), nullif(trim(p->>'note'), '')
  );

  return jsonb_build_object('ok', true, 'id', new_id);
end $$;

-- 同意画面に出す「提供先」の一覧（承認済みの会社名と免許番号のみ）
create or replace function public.get_public_partners()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'company_name', company_name, 'license_no', license_no, 'areas', areas)
         order by company_name), '[]'::jsonb)
  from public.partners where approved;
$$;

create or replace function public.get_public_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('max_buyers', max_buyers, 'consent_version', consent_version)
  from public.settings where id = 1;
$$;

-- ------------------------------------------------------------
-- 不動産会社
-- ------------------------------------------------------------
create or replace function public.register_partner(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  areas_in text[];
begin
  if uid is null then raise exception 'ログインが必要です' using errcode = '28000'; end if;
  select coalesce(array_agg(x), '{}') into areas_in
    from jsonb_array_elements_text(coalesce(p->'areas', '[]'::jsonb)) x;

  insert into public.partners (id, company_name, license_no, representative, phone, email, areas)
  values (uid, trim(p->>'company_name'), trim(p->>'license_no'), trim(p->>'representative'),
          trim(p->>'phone'), (select email from auth.users where id = uid), areas_in)
  on conflict (id) do update set
    company_name   = excluded.company_name,
    license_no     = excluded.license_no,
    representative = excluded.representative,
    phone          = excluded.phone,
    areas          = excluded.areas,
    -- 承認後に免許番号が変わった場合は、改めて審査する
    approved       = case when public.partners.license_no = excluded.license_no
                          then public.partners.approved else false end;
  -- 承認・クレジットは本人が変えられない（運営のみ）
  return public.my_partner();
end $$;

create or replace function public.my_partner()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else
    to_jsonb(p) || jsonb_build_object('lead_price', s.lead_price) end
  from public.settings s
  left join public.partners p on p.id = auth.uid()
  where s.id = 1;
$$;

-- 購入できる査定依頼の一覧（プレビュー情報のみ）
create or replace function public.list_open_leads()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me public.partners;
  s public.settings;
begin
  select * into me from public.partners where id = auth.uid();
  if me.id is null or not me.approved then
    raise exception '承認済みの不動産会社のみ閲覧できます' using errcode = '42501';
  end if;
  select * into s from public.settings where id = 1;

  return coalesce((
    select jsonb_agg(public.lead_preview(l) || jsonb_build_object('price', s.lead_price)
                     order by l.created_at desc)
    from public.leads l
    where l.status = 'open'
      and l.buyer_count < l.max_buyers
      and l.created_at > now() - make_interval(days => s.lead_ttl_days)
      and (cardinality(me.areas) = 0 or l.prefecture = any (me.areas))
      and not exists (select 1 from public.purchases pu where pu.lead_id = l.id and pu.partner_id = me.id)
  ), '[]'::jsonb);
end $$;

-- 購入（クレジットを消費して連絡先を開示）
create or replace function public.purchase_lead(p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  l public.leads;
  me public.partners;
  c public.lead_contacts;
  s public.settings;
begin
  if uid is null then raise exception 'ログインが必要です' using errcode = '28000'; end if;
  select * into s from public.settings where id = 1;

  -- 同時購入で上限を超えないよう、査定依頼 → 会社 の順に行ロックを取る
  select * into l from public.leads where id = p_lead_id for update;
  if l.id is null then raise exception '査定依頼が見つかりません' using errcode = 'P0002'; end if;
  select * into me from public.partners where id = uid for update;

  if me.id is null or not me.approved then
    raise exception '承認済みの不動産会社のみ購入できます' using errcode = '42501';
  end if;
  if exists (select 1 from public.purchases where lead_id = l.id and partner_id = uid) then
    raise exception 'この査定依頼はすでに購入済みです' using errcode = '23505';
  end if;
  if l.status <> 'open' or l.buyer_count >= l.max_buyers
     or l.created_at <= now() - make_interval(days => s.lead_ttl_days) then
    raise exception 'この査定依頼は受付を終了しました' using errcode = 'P0001';
  end if;
  if cardinality(me.areas) > 0 and not (l.prefecture = any (me.areas)) then
    raise exception '対応エリア外の査定依頼です' using errcode = '42501';
  end if;
  if me.credits < s.lead_price then
    raise exception 'クレジットが不足しています（必要: %、残高: %）', s.lead_price, me.credits using errcode = 'P0001';
  end if;

  insert into public.purchases (lead_id, partner_id, price) values (l.id, uid, s.lead_price);
  update public.partners set credits = credits - s.lead_price where id = uid;
  insert into public.credit_ledger (partner_id, amount, reason, created_by)
    values (uid, -s.lead_price, '査定依頼の購入 ' || l.id, uid);
  update public.leads
     set buyer_count = buyer_count + 1,
         status = case when buyer_count + 1 >= max_buyers then 'closed' else status end
   where id = l.id
   returning * into l;

  select * into c from public.lead_contacts where lead_id = l.id;
  return public.lead_full(l, c);
end $$;

-- 購入済みの査定依頼（全情報）
create or replace function public.my_purchases()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.lead_full(l, c) || jsonb_build_object('purchased_at', pu.purchased_at)
                  order by pu.purchased_at desc), '[]'::jsonb)
  from public.purchases pu
  join public.leads l on l.id = pu.lead_id
  left join public.lead_contacts c on c.lead_id = l.id
  where pu.partner_id = auth.uid()
    and l.status <> 'withdrawn';   -- 本人が取り下げた依頼は購入後でも表示しない
$$;

-- ------------------------------------------------------------
-- 運営
-- ------------------------------------------------------------
create or replace function public.require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception '運営者のみ実行できます' using errcode = '42501';
  end if;
end $$;

create or replace function public.admin_list_partners()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object(
            'purchase_count', (select count(*) from public.purchases pu where pu.partner_id = p.id))
          order by p.approved, p.created_at desc) from public.partners p), '[]'::jsonb);
end $$;

create or replace function public.admin_set_partner_approval(p_partner_id uuid, p_approved boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  update public.partners set approved = p_approved where id = p_partner_id;
  if not found then raise exception '不動産会社が見つかりません' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_add_credits(p_partner_id uuid, p_amount int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare bal int;
begin
  perform public.require_admin();
  if p_amount = 0 then raise exception '0は指定できません' using errcode = '22023'; end if;
  update public.partners set credits = credits + p_amount where id = p_partner_id returning credits into bal;
  if not found then raise exception '不動産会社が見つかりません' using errcode = 'P0002'; end if;
  insert into public.credit_ledger (partner_id, amount, reason, created_by)
    values (p_partner_id, p_amount, coalesce(nullif(trim(p_reason), ''), '運営による調整'), auth.uid());
  return jsonb_build_object('ok', true, 'credits', bal);
end $$;

create or replace function public.admin_list_leads()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(public.lead_full(l, c) || jsonb_build_object(
             'buyers', (select coalesce(jsonb_agg(jsonb_build_object(
                          'company_name', p.company_name, 'purchased_at', pu.purchased_at)
                          order by pu.purchased_at), '[]'::jsonb)
                        from public.purchases pu join public.partners p on p.id = pu.partner_id
                        where pu.lead_id = l.id))
           order by l.created_at desc)
    from public.leads l left join public.lead_contacts c on c.lead_id = l.id
  ), '[]'::jsonb);
end $$;

-- 取り下げ：本人からの申し出を受けて運営が実行する。
-- 連絡先は削除するが、提供記録（誰にいつ渡したか）は法定の保存期間のため残す
create or replace function public.admin_withdraw_lead(p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  update public.leads set status = 'withdrawn' where id = p_lead_id;
  if not found then raise exception '査定依頼が見つかりません' using errcode = 'P0002'; end if;
  delete from public.lead_contacts where lead_id = p_lead_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_update_settings(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.settings;
begin
  perform public.require_admin();
  update public.settings set
    lead_price      = coalesce((p->>'lead_price')::int, lead_price),
    max_buyers      = coalesce((p->>'max_buyers')::int, max_buyers),
    lead_ttl_days   = coalesce((p->>'lead_ttl_days')::int, lead_ttl_days),
    consent_version = coalesce(nullif(p->>'consent_version', ''), consent_version)
  where id = 1 returning * into s;
  return to_jsonb(s);
end $$;

create or replace function public.admin_get_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return (select to_jsonb(s) from public.settings s where id = 1);
end $$;

-- ------------------------------------------------------------
-- 実行権限：既定の付与をすべて外してから、必要なものだけ渡す
-- ------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.submit_lead(jsonb)          to anon, authenticated;
grant execute on function public.get_public_partners()       to anon, authenticated;
grant execute on function public.get_public_settings()       to anon, authenticated;

grant execute on function public.register_partner(jsonb)     to authenticated;
grant execute on function public.my_partner()                to authenticated;
grant execute on function public.list_open_leads()           to authenticated;
grant execute on function public.purchase_lead(uuid)         to authenticated;
grant execute on function public.my_purchases()              to authenticated;
grant execute on function public.is_admin()                  to authenticated;

grant execute on function public.admin_list_partners()                       to authenticated;
grant execute on function public.admin_set_partner_approval(uuid, boolean)   to authenticated;
grant execute on function public.admin_add_credits(uuid, int, text)          to authenticated;
grant execute on function public.admin_list_leads()                          to authenticated;
grant execute on function public.admin_withdraw_lead(uuid)                   to authenticated;
grant execute on function public.admin_update_settings(jsonb)                to authenticated;
grant execute on function public.admin_get_settings()                       to authenticated;

-- ------------------------------------------------------------
-- 最初の運営者の登録（自分のアカウントでログインした後に、ユーザーIDを入れて実行）
--   insert into public.admins (user_id) values ('ここにユーザーID');
-- ------------------------------------------------------------
