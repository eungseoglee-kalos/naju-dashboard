-- 코팅현황 대시보드(/coating)용 테이블.
--
-- ⚠ 이 파일은 다른 스키마 파일들과 성격이 다릅니다. 이 테이블은 저장소에
-- 스키마 파일이 생기기 전에 Supabase 편집기에서 직접 만들어졌고, 이 DDL 은
-- 나중에 운영 중인 테이블의 구조를 읽어 복원한 것입니다. 컬럼과 NOT NULL 은
-- 실제 스키마와 일치하지만, 인덱스와 RLS 정책의 "이름"까지 원래 것과 같은지는
-- 확인할 수 없었습니다.
--
-- 따라서:
--   * 새 환경을 처음부터 구축할 때 → 그대로 실행하면 됩니다.
--   * 이미 돌고 있는 현재 DB 에 실행할 때 → 테이블은 그대로 두지만
--     아래 이름의 정책이 새로 생겨, 기존 정책과 나란히 남을 수 있습니다.
--     (둘 다 permissive 라 동작은 같지만 목록이 지저분해집니다)

create table if not exists public.coating_records (
  id              bigint generated always as identity primary key,
  coating_lot     text        not null,   -- 코팅LOT
  coating_date    date        not null,   -- 코팅일자
  part_number     text        not null,   -- 품번
  serial_no       text,                   -- 관리번호
  spec            text,                   -- 규격 (2026-08-21부터 추가된 열; "1400" 포함 시 고온열처리)
  coating_round   text        not null,   -- 코팅차수
  round_no        integer,                -- 차수 숫자만 (1, 2, 3...)
  position        text,                   -- 위치 (UP / DOWN)
  direction       text,                   -- 방향
  note            text,
  inspection_date date,                   -- 검사일자
  front_result    text,                   -- 앞면 판정
  back_result     text,                   -- 뒷면 판정
  recoat          text,                   -- 재코팅
  shape_fix       text,                   -- 형상수정
  inspection_note text,
  final_verdict   text        not null,   -- 최종판정 (1.OK / 2.NG / 3.검사대기 / 4.폐기)
  note2           text,
  work_order_no   text,                   -- 작업지시번호
  source_sheet    text,                   -- 원본 시트 구분
  created_at      timestamptz not null default now()
);

-- 2026-08-21에 원본 엑셀에 "규격" 열이 새로 생겨서 추가한다. 이미 운영 중인
-- DB에도 안전하게 실행 가능(이미 있으면 아무 일도 안 함).
alter table public.coating_records add column if not exists spec text;

create index if not exists coating_records_coating_date_idx
  on public.coating_records (coating_date);

alter table public.coating_records enable row level security;

drop policy if exists "authenticated can read coating records"
  on public.coating_records;
create policy "authenticated can read coating records"
  on public.coating_records for select to authenticated using (true);

drop policy if exists "authenticated can insert coating records"
  on public.coating_records;
create policy "authenticated can insert coating records"
  on public.coating_records for insert to authenticated with check (true);

drop policy if exists "authenticated can delete coating records"
  on public.coating_records;
create policy "authenticated can delete coating records"
  on public.coating_records for delete to authenticated using (true);
