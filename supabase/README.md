# Supabase 스키마

**이 폴더의 `.sql` 파일이 스키마의 원본입니다.** Supabase SQL 편집기에 저장된
스니펫(`Untitled query` 등)은 여기 내용을 붙여넣고 실행한 흔적일 뿐이라, 지워도
데이터베이스에는 아무 영향이 없습니다. 스키마를 바꿀 일이 생기면 **먼저 이 파일을
고치고** 그 내용을 실행하세요. 편집기 안에서만 고치면 저장소가 조용히 낡습니다.

실행하는 곳:
https://supabase.com/dashboard/project/ctmetyjsfoebkbzkeqif/sql/new

## 파일과 대상

| 파일 | 테이블 | 쓰는 곳 |
|---|---|---|
| `coating_records.sql` | `coating_records` | `/coating` |
| `production_plan_records.sql` | `production_plan_records` | `/production-plan` |
| `shipment_records.sql` | `heater_coil_shipments`, `mesh_shipments` | `/heater-coil`, `/mesh` |
| `vm_records.sql` | `vm_shipments`, `vm_backlog` | `/vm-coil` |
| `connector_quality.sql` | `connector_quality_records`, `connector_defect_details` | `/connector-quality` |
| `sync_log.sql` | `sync_log` | 전 대시보드의 "마지막 갱신" 배지, 취합 이력 |
| `admin_and_dashboard_order.sql` | `profiles.is_admin`, `dashboard_order` | `/admin` (관리자 지정, 대시보드 순서) |
| `dashboard_access.sql` | `profiles.allowed_dashboards` | `/admin` (사용자별 대시보드 열람 권한) |
| `harden_rls.sql` | 전체 테이블의 RLS 정책 | 승인된 회원만 읽기, 쓰기는 서비스 롤만 |

`profiles` 자체(가입 시 행 생성)는 인증에 딸린 것이라 여기서 만들지 않지만,
그 위에 얹는 컬럼(`is_admin`, `allowed_dashboards`)과 정책은 위 파일들이
관리합니다.

## 전부 멱등입니다

모든 파일이 `create table if not exists`, `create index if not exists`,
`drop policy if exists` → `create policy` 로만 되어 있습니다. 가드 없는
`create` 는 하나도 없습니다.

그래서 **어느 파일을 이미 적용했는지 기억할 필요가 없습니다.** 헷갈리면 순서 상관없이
전부 다시 실행하면 되고, 기존 테이블과 데이터는 그대로 남습니다.

한 가지 예외는 `coating_records.sql` 입니다. 이 테이블만 저장소에 스키마 파일이
생기기 전에 편집기에서 직접 만들어졌고, 파일은 나중에 운영 테이블을 읽어 복원한
것입니다. 새 환경 구축에는 그대로 쓸 수 있지만, 현재 DB 에 실행하면 정책이
이 파일의 이름으로 새로 생겨 기존 정책과 나란히 남을 수 있습니다. 자세한 내용은
파일 상단 주석에 적어두었습니다.

## RLS 규칙

데이터 테이블은 전부 같은 형태입니다 (`harden_rls.sql` 적용 이후).

- RLS 켜짐. **anon 키로는 아무것도 보이지 않습니다.**
- `authenticated` 에게 `select` 만 허용하고, **그중에서도 `profiles.is_approved`
  (또는 `is_admin`) 인 회원만** 실제로 행을 볼 수 있습니다 (`is_approved_user()`
  헬퍼).
- `insert` / `delete` 정책은 두지 않습니다. 실제 쓰기는 전부 서비스 롤 키로만
  하므로(아래), 로그인 세션에게 쓰기를 열어둘 이유가 없습니다.

과거에는 `authenticated` 이면 승인 여부와 무관하게 전부 읽고 쓸 수 있었습니다
— 화면의 "관리자 승인 대기"는 애플리케이션에서만 확인했을 뿐, anon 키를 아는
누구나(브라우저에서 항상 볼 수 있는 값입니다) REST API로 직접 모든 표를
읽거나 지울 수 있었습니다. `harden_rls.sql` 이 이 구멍을 막습니다.

관리자만 업로드할 수 있게 막는 것은 여전히 애플리케이션이 합니다 —
`app/admin/actions.ts` 의 `requireAdmin()`, 그리고 `app/api/ingest/route.ts` 의
`INGEST_TOKEN` 검사입니다. DB 쪽 정책은 "승인된 회원만 읽기"까지만 보장합니다.

자동 취합은 RLS 를 우회하는 서비스 롤 키를 쓰므로(`lib/supabase/admin.ts`),
토큰 검사를 통과하기 전에는 어떤 DB 작업도 하지 않습니다.

## 데이터가 들어오는 경로

엑셀 업로드는 한 곳으로 모입니다 (`lib/ingest.ts`).

1. 워크북의 **시트 이름**으로 어느 테이블에 넣을지 판별합니다.
   한 파일에 여러 시트가 있으면 함께 반영됩니다.
2. 파싱 결과가 기존 행 수의 **50% 미만이면 거부**하고 기존 데이터를 지킵니다.
   엑셀이 잠겼거나 반쪽만 동기화된 파일이 멀쩡한 데이터를 지우는 것을 막습니다.
   `vm_backlog` 만 예외로 이 가드를 끕니다 — 당월에 남은 주문만 담은 스냅샷이라
   행 수가 크게 줄어드는 것이 정상이기 때문입니다.
3. 성공/실패 모두 `sync_log` 에 남고, 실패하면 관리자에게 메일이 갑니다.

들어오는 문은 두 개이고 둘 다 위 경로를 그대로 탑니다.

- 관리자 페이지의 수동 업로드 (`/admin`)
- `POST /api/ingest` — 사내 PC 의 작업 스케줄러가 매일 09:00 / 18:00 (KST)에
  `scripts/upload-to-naju.ps1` 로 엑셀을 보냅니다.
