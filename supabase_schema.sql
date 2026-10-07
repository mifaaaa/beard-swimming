-- 鬍子泳隊 v2 / Supabase schema
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'coach' check (role in ('coach','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.swimmers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  gender text,
  school text,
  grade text,
  birth date,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.performances (
  id uuid primary key default gen_random_uuid(),
  swimmer_id uuid references public.swimmers(id) on delete cascade,
  swimmer_name text not null,
  course text not null check (course in ('長池','短池')),
  event text not null,
  seconds numeric(8,3) not null check (seconds > 0),
  swim_date date,
  meet text,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.team_records (
  id uuid primary key default gen_random_uuid(),
  course text not null check (course in ('長池','短池')),
  gender text not null,
  event text not null,
  swimmer_id uuid references public.swimmers(id) on delete set null,
  swimmer_name text not null,
  seconds numeric(8,3) not null check (seconds > 0),
  meet text,
  updated_at timestamptz not null default now(),
  unique(course,gender,event)
);

alter table public.profiles enable row level security;
alter table public.swimmers enable row level security;
alter table public.performances enable row level security;
alter table public.team_records enable row level security;

create or replace function public.is_coach()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role in ('coach','admin'));
$$;

drop policy if exists "public read swimmers" on public.swimmers;
create policy "public read swimmers" on public.swimmers for select using (true);
drop policy if exists "public read performances" on public.performances;
create policy "public read performances" on public.performances for select using (true);
drop policy if exists "public read team records" on public.team_records;
create policy "public read team records" on public.team_records for select using (true);

drop policy if exists "coach write swimmers" on public.swimmers;
create policy "coach write swimmers" on public.swimmers for all using (public.is_coach()) with check (public.is_coach());
drop policy if exists "coach write performances" on public.performances;
create policy "coach write performances" on public.performances for all using (public.is_coach()) with check (public.is_coach());
drop policy if exists "coach write team records" on public.team_records;
create policy "coach write team records" on public.team_records for all using (public.is_coach()) with check (public.is_coach());

create or replace function public.record_performance(
  swimmer_name text, course text, event text, seconds numeric,
  swim_date date default current_date, meet text default null, note text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  sw_id uuid; old_pb numeric; record_gender text; old_record numeric; new_record boolean := false;
begin
  if not public.is_coach() then raise exception '沒有教練權限'; end if;
  if seconds <= 0 then raise exception '成績必須大於 0 秒'; end if;

  select id, gender into sw_id, record_gender from public.swimmers where name=record_performance.swimmer_name;
  if sw_id is null then raise exception '找不到隊員：% ', swimmer_name; end if;

  insert into public.performances(swimmer_id,swimmer_name,course,event,seconds,swim_date,meet,note,created_by)
  values(sw_id,swimmer_name,course,event,seconds,swim_date,meet,note,auth.uid());

  select min(p.seconds) into old_pb from public.performances p
  where p.swimmer_id=sw_id and p.course=record_performance.course and p.event=record_performance.event;

  select tr.seconds into old_record from public.team_records tr
  where tr.course=record_performance.course and tr.gender=record_gender and tr.event=record_performance.event;

  if old_record is null or seconds < old_record then
    insert into public.team_records(course,gender,event,swimmer_id,swimmer_name,seconds,meet,updated_at)
    values(course,record_gender,event,sw_id,swimmer_name,seconds,meet,now())
    on conflict(course,gender,event) do update set
      swimmer_id=excluded.swimmer_id, swimmer_name=excluded.swimmer_name,
      seconds=excluded.seconds, meet=excluded.meet, updated_at=now();
    new_record := true;
  end if;

  return jsonb_build_object('message',
    case when new_record then '成績已儲存，恭喜刷新隊史紀錄！'
         else '成績已儲存，PB／隊史已自動判定。' end,
    'new_team_record',new_record,'pb',old_pb);
end $$;

-- 建立教練帳號後，請在 Supabase SQL Editor 執行：
-- insert into public.profiles(id, display_name, role) values ('你的 Auth User UUID','教練','admin');
