-- 커넥터 품질실적 대시보드(/connector-quality)용 테이블.
--
-- Supabase SQL Editor 에서 한 번 실행하면 됩니다. 다른 파일들과 마찬가지로
-- 멱등이라 여러 번 실행해도 안전합니다.
--
-- RLS 는 harden_rls.sql 이후의 규칙을 그대로 따릅니다: 승인된 회원만
-- select 가능하고, insert/delete 정책은 두지 않습니다(쓰기는 서비스 롤만,
-- lib/ingest.ts).

create table if not exists public.connector_quality_records (
  id            bigint generated always as identity primary key,
  work_date     date        not null,   -- 작업일
  process       text        not null,   -- 공정 (커넥터 세척/검사1/검사2/홀가공/절단)
  part_number   text        not null,   -- 품목 (예: HMCNT0085)
  part_code     text,                   -- 품목에서 뽑은 4자리 코드 (예: 0085)
  spec          text,                   -- 규격
  item_name     text,                   -- 품목명
  category_major text,                  -- 대분류
  category_mid   text,                  -- 중분류
  category_sub   text,                  -- 소분류
  qty_total     numeric     not null default 0,  -- 실적수량
  qty_defect    numeric     not null default 0,  -- 불량수량
  qty_good      numeric     not null default 0,  -- 양품수량
  created_at    timestamptz not null default now()
);

create index if not exists connector_quality_records_work_date_idx
  on public.connector_quality_records (work_date);

alter table public.connector_quality_records enable row level security;

drop policy if exists "authenticated can read connector records" on public.connector_quality_records;
drop policy if exists "authenticated can insert connector records" on public.connector_quality_records;
drop policy if exists "authenticated can delete connector records" on public.connector_quality_records;
drop policy if exists "approved users can read connector records" on public.connector_quality_records;
create policy "approved users can read connector records"
  on public.connector_quality_records for select to authenticated
  using (public.is_approved_user(auth.uid()));

create table if not exists public.connector_defect_details (
  id            bigint generated always as identity primary key,
  work_date     date        not null,   -- 실적일
  process       text        not null,   -- 공정명
  part_number   text        not null,   -- 품목
  part_code     text,                   -- 품목에서 뽑은 4자리 코드
  item_name     text,                   -- 품목명
  spec          text,                   -- 규격
  defect_code   text,                   -- 불량코드
  defect_type   text        not null,   -- 불량내역 (공정불량/성형불량/커넥터 외관불량 등)
  cause_code    text,                   -- 불량원인코드
  cause         text,                   -- 불량원인
  qty_total     numeric     not null default 0,  -- 작업수량
  qty_defect    numeric     not null default 0,  -- 불량수량
  created_at    timestamptz not null default now()
);

create index if not exists connector_defect_details_work_date_idx
  on public.connector_defect_details (work_date);

alter table public.connector_defect_details enable row level security;

drop policy if exists "approved users can read connector defects" on public.connector_defect_details;
create policy "approved users can read connector defects"
  on public.connector_defect_details for select to authenticated
  using (public.is_approved_user(auth.uid()));
