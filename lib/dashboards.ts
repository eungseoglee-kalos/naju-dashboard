export type DashboardEntry = {
  href: string;
  title: string;
  description: string;
};

/**
 * 대시보드 카탈로그. 제목·설명은 코드로 관리하고, 화면에 보이는 순서만
 * dashboard_order 테이블이 정합니다 (관리자 페이지에서 변경).
 *
 * 새 대시보드를 여기에 추가하면 DB 에 행이 없으므로 목록 맨 뒤에 붙습니다.
 */
export const DASHBOARDS: DashboardEntry[] = [
  {
    href: "/coating",
    title: "코팅현황",
    description: "나주공장 코팅 생산 및 검사 실적",
  },
  {
    href: "/production-plan",
    title: "생산계획 대비 실적",
    description: "부서·공정별 생산계획 달성률 및 미달 유형 분석",
  },
  {
    href: "/heater-coil",
    title: "히터코일 출하현황",
    description: "히터코일 월별 출하량, 코팅업체별 실적 및 수주잔량",
  },
  {
    href: "/mesh",
    title: "메시 출하현황",
    description: "메시 월별 출하량, 가공처별 실적 및 수주잔량",
  },
  {
    href: "/vm-coil",
    title: "진공증착 생산실적",
    description: "증착코일·증착재 출하 중량, 외주비율 및 전년 대비 증감",
  },
  {
    href: "/connector-quality",
    title: "커넥터 품질실적",
    description: "커넥터 공정별 불량률, 품질목표 달성률 및 불량유형 분석",
  },
  {
    href: "/electron-beam-quality",
    title: "전자빔 품질실적",
    description: "전자빔 공정별 불량률, 품질목표 달성률 및 불량유형 분석",
  },
  {
    href: "/mesh-quality",
    title: "메시 품질실적",
    description: "메시 공정별 불량률, 품질목표 달성률 및 불량유형 분석",
  },
  {
    href: "/vm-quality",
    title: "VM코일 품질실적",
    description: "VM코일 공정별 불량률, 품질목표 달성률 및 불량유형 분석",
  },
];

// 목록 위치에 따라 색이 돌아가므로, 순서를 바꾸면 카드 색도 함께 바뀝니다.
export const DASHBOARD_COLOR_CLASSES = [
  "border-blue-200 bg-blue-50 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950 dark:hover:bg-blue-900",
  "border-green-200 bg-green-50 hover:bg-green-100 dark:border-green-900 dark:bg-green-950 dark:hover:bg-green-900",
  "border-amber-200 bg-amber-50 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:hover:bg-amber-900",
  "border-purple-200 bg-purple-50 hover:bg-purple-100 dark:border-purple-900 dark:bg-purple-950 dark:hover:bg-purple-900",
  "border-teal-200 bg-teal-50 hover:bg-teal-100 dark:border-teal-900 dark:bg-teal-950 dark:hover:bg-teal-900",
  "border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:hover:bg-red-900",
] as const;

export type DashboardOrderRow = { href: string; sort_order: number };

/** allowed 가 null 이면 전부 열람 가능. 관리자 페이지에서 사용자별로 설정한다. */
export function canAccessDashboard(href: string, allowed: string[] | null) {
  return allowed === null || allowed.includes(href);
}

export function filterDashboards(
  dashboards: DashboardEntry[],
  allowed: string[] | null,
): DashboardEntry[] {
  if (allowed === null) return dashboards;
  return dashboards.filter((d) => allowed.includes(d.href));
}

/**
 * 저장된 순서를 카탈로그에 입힌다. 저장된 값이 없는 항목(코드에 새로 추가된
 * 대시보드)은 코드 순서를 유지한 채 뒤에 붙는다. 반대로 DB 에만 있고 코드에서
 * 사라진 href 는 그냥 무시된다.
 */
export function orderDashboards(
  saved: DashboardOrderRow[] | null | undefined,
): DashboardEntry[] {
  const rank = new Map((saved ?? []).map((r) => [r.href, r.sort_order]));
  return DASHBOARDS.map((d, i) => ({ d, i }))
    .sort((a, b) => {
      const ra = rank.get(a.d.href);
      const rb = rank.get(b.d.href);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.i - b.i;
    })
    .map(({ d }) => d);
}
