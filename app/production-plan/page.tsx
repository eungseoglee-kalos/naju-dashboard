"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { TOOLTIP_PROPS, percentTicks } from "@/lib/chart";
import { useIsDark } from "@/lib/use-is-dark";
import {
  toFailType,
  FAIL_TYPE_COLORS,
  type FailTypeMode,
} from "@/lib/fail-type";
import LastSyncBadge from "@/components/dashboard/LastSyncBadge";
import { periodDefaults } from "@/lib/period";
import { labelNumber, labelPercent } from "@/lib/format";

type PlanRecord = {
  record_date: string;
  division: string | null;
  department: string | null;
  process: string | null;
  part_number: string | null;
  plan_qty: number | null;
  actual_qty: number | null;
  achieved: boolean;
  fail_type: string | null;
  fail_reason: string | null;
};

const SELECT_COLUMNS =
  "record_date, division, department, process, part_number, plan_qty, actual_qty, achieved, fail_type, fail_reason";

// Matches the Power BI report's legend order/colors so the two read the same.
const SERIES_COLORS = [
  "#38bdf8",
  "#1e3a8a",
  "#f97316",
  "#7c3aed",
  "#ec4899",
  "#a855f7",
  "#059669",
  "#dc2626",
];

const BLANK_LABEL = "(공백)";
const PROCESS_CHART_LIMIT = 15;

function pct(v: number | null) {
  return v === null ? "-" : `${Math.round(v * 100)}%`;
}

/**
 * 미달 상세표의 계획/실적 수량. 원본에 1/3 처럼 나누어떨어지지 않는 값이 있어
 * 그대로 두면 소수가 길게 늘어진다. 소수 첫째 자리까지만 보이고, 정수는 정수로
 * 둔다 (36 을 "36.0" 으로 쓰지 않는다).
 */
function qty(v: number | null): string {
  if (v === null || v === undefined) return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return (Math.round(n * 10) / 10).toLocaleString("ko-KR", {
    maximumFractionDigits: 1,
  });
}

function achievementRate(records: PlanRecord[]) {
  if (records.length === 0) return null;
  return records.filter((r) => r.achieved).length / records.length;
}

// ~34k rows at 1000 per request, so the pages are fetched concurrently
// instead of walking them one at a time like the coating dashboard does.
async function fetchAllPlanRecords(): Promise<PlanRecord[]> {
  const supabase = createClient();
  const pageSize = 1000;

  const { count, error: countError } = await supabase
    .from("production_plan_records")
    .select("*", { count: "exact", head: true });

  if (countError) throw countError;
  if (!count) return [];

  const ranges: [number, number][] = [];
  for (let from = 0; from < count; from += pageSize) {
    ranges.push([from, Math.min(from + pageSize, count) - 1]);
  }

  const pages = await Promise.all(
    ranges.map(async ([from, to]) => {
      const { data, error } = await supabase
        .from("production_plan_records")
        .select(SELECT_COLUMNS)
        .order("record_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return (data ?? []) as PlanRecord[];
    }),
  );

  return pages.flat();
}

export default function ProductionPlanPage() {
  const [records, setRecords] = useState<PlanRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 데이터가 있는 마지막 달로 열되, 사용자가 고르면 그 선택을 따른다
  // ("전체"도 유효한 선택이므로 null 만 "아직 안 고름"을 뜻한다).
  const [yearOverride, setYearOverride] = useState<string | null>(null);
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const [selectedDivisions, setSelectedDivisions] = useState<Set<string>>(
    new Set(),
  );
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set());
  // 대분류가 기본값이다. 기간 필터 없이 열면 2024년(구 분류)부터 2026년(신 분류)이
  // 한 화면에 섞이는데, 그때 비교 가능한 쪽은 대분류뿐이다.
  const [failTypeMode, setFailTypeMode] = useState<FailTypeMode>("group");
  const isDark = useIsDark();
  const axisColor = isDark ? "#d4d4d4" : "#404040";
  const labelColor = isDark ? "#f5f5f5" : "#171717";

  useEffect(() => {
    fetchAllPlanRecords()
      .then(setRecords)
      .catch((e) => setError(e.message ?? "데이터를 불러오지 못했습니다."));
  }, []);

  const divisions = useMemo(() => {
    if (!records) return [];
    return Array.from(
      new Set(records.map((r) => r.division).filter((v): v is string => !!v)),
    ).sort();
  }, [records]);

  const departments = useMemo(() => {
    if (!records) return [];
    return Array.from(
      new Set(records.map((r) => r.department).filter((v): v is string => !!v)),
    ).sort();
  }, [records]);

  const years = useMemo(() => {
    if (!records) return [];
    return Array.from(
      new Set(records.map((r) => r.record_date.slice(0, 4))),
    ).sort();
  }, [records]);

  const latestDate = useMemo(() => {
    if (!records || records.length === 0) return null;
    return records.reduce(
      (max, r) => (r.record_date > max ? r.record_date : max),
      records[0].record_date,
    );
  }, [records]);

  const defaults = useMemo(
    () => periodDefaults(records?.map((r) => r.record_date) ?? []),
    [records],
  );
  const year = yearOverride ?? defaults.year;
  const month = monthOverride ?? defaults.month;

  // Org filters only -- the two trend charts below need every month in view,
  // so they must not be narrowed by the 연도/월 pickers.
  const orgFiltered = useMemo(() => {
    if (!records) return [];
    return records.filter((r) => {
      if (
        selectedDivisions.size > 0 &&
        (!r.division || !selectedDivisions.has(r.division))
      )
        return false;
      if (
        selectedDepts.size > 0 &&
        (!r.department || !selectedDepts.has(r.department))
      )
        return false;
      return true;
    });
  }, [records, selectedDivisions, selectedDepts]);

  // Org filters + 연도, ignoring 월: the monthly trends stay readable while
  // still honouring a year selection.
  const yearFiltered = useMemo(() => {
    return orgFiltered.filter(
      (r) => year === "all" || r.record_date.slice(0, 4) === year,
    );
  }, [orgFiltered, year]);

  // Everything, including 월 -- used by the KPIs and the two breakdowns.
  const filtered = useMemo(() => {
    return yearFiltered.filter(
      (r) => month === "all" || r.record_date.slice(5, 7) === month,
    );
  }, [yearFiltered, month]);

  const kpi = useMemo(() => {
    const total = filtered.length;
    const hit = filtered.filter((r) => r.achieved).length;
    return { total, hit, miss: total - hit, rate: achievementRate(filtered) };
  }, [filtered]);

  const monthlyTrend = useMemo(() => {
    const byMonth = new Map<string, PlanRecord[]>();
    for (const r of yearFiltered) {
      const key = r.record_date.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(r);
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, recs]) => ({
        month: key.slice(2),
        count: recs.length,
        ratePct: Math.round((achievementRate(recs) ?? 0) * 100),
      }));
  }, [yearFiltered]);

  const deptTrend = useMemo(() => {
    const months = Array.from(
      new Set(yearFiltered.map((r) => r.record_date.slice(0, 7))),
    ).sort();
    const depts = Array.from(
      new Set(
        yearFiltered.map((r) => r.department).filter((v): v is string => !!v),
      ),
    ).sort();

    const data = months.map((m) => {
      const row: Record<string, string | number | null> = { month: m.slice(2) };
      for (const dept of depts) {
        const recs = yearFiltered.filter(
          (r) => r.record_date.slice(0, 7) === m && r.department === dept,
        );
        const rate = achievementRate(recs);
        row[dept] = rate === null ? null : Math.round(rate * 100);
      }
      return row;
    });

    return { data, depts };
  }, [yearFiltered]);

  // 달성률은 대개 60~100% 사이라 0 부터 그리면 변화가 뭉개진다. 50% 부터
  // 10% 간격으로 끊되, 그 아래로 떨어진 달이 있으면 축을 더 내려 잡는다.
  const monthlyAxis = useMemo(
    () => percentTicks(monthlyTrend.map((d) => d.ratePct)),
    [monthlyTrend],
  );

  const deptAxis = useMemo(
    () =>
      percentTicks(
        deptTrend.data.flatMap((row) =>
          deptTrend.depts.map((d) => row[d] as number | null),
        ),
      ),
    [deptTrend],
  );

  const processRate = useMemo(() => {
    const byProcess = new Map<string, PlanRecord[]>();
    for (const r of filtered) {
      const key = r.process ?? BLANK_LABEL;
      if (!byProcess.has(key)) byProcess.set(key, []);
      byProcess.get(key)!.push(r);
    }
    return Array.from(byProcess.entries())
      .map(([process, recs]) => ({
        process,
        count: recs.length,
        ratePct: Math.round((achievementRate(recs) ?? 0) * 100),
      }))
      .sort((a, b) => a.ratePct - b.ratePct || b.count - a.count)
      .slice(0, PROCESS_CHART_LIMIT);
  }, [filtered]);

  const failTypeBreakdown = useMemo(() => {
    const missed = filtered.filter((r) => !r.achieved);
    const byType = new Map<string, number>();
    for (const r of missed) {
      const key = toFailType(r.fail_type, failTypeMode);
      byType.set(key, (byType.get(key) ?? 0) + 1);
    }
    return Array.from(byType.entries())
      .map(([name, count]) => ({
        name,
        count,
        value: Math.round((count / missed.length) * 10000) / 100,
      }))
      .sort((a, b) => b.count - a.count);
  }, [filtered, failTypeMode]);

  // 파이 레이블이 겹치기 시작하는 지점. 위 목록이 비중 내림차순이라 이 index
  // 이후는 전부 "작은 조각"이다. 해당 없으면 -1.
  const smallSliceFrom = useMemo(
    () => failTypeBreakdown.findIndex((d) => d.value < 5),
    [failTypeBreakdown],
  );

  const missDetail = useMemo(() => {
    return filtered
      .filter((r) => !r.achieved)
      .sort((a, b) => b.record_date.localeCompare(a.record_date))
      .slice(0, 300);
  }, [filtered]);

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (!records) {
    return <p className="text-sm text-foreground/60">불러오는 중...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">생산 계획 대비 달성률 현황</h1>
          <p className="text-xs text-foreground/60">
            달성 기준: 계획 수량 대비 ±10% 이내
          </p>
        </div>
        <div className="text-right">
          {latestDate && (
            <p className="text-xs text-foreground/60">
              최종 실적일 {latestDate}
            </p>
          )}
          <LastSyncBadge table="production_plan_records" />
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div>
          <label className="mb-1 block text-xs text-foreground/60">연도</label>
          <select
            value={year}
            onChange={(e) => setYearOverride(e.target.value)}
            className="rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm text-black dark:border-white/10 dark:bg-neutral-800 dark:text-white"
          >
            <option value="all">전체</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/60">월</label>
          <select
            value={month}
            onChange={(e) => setMonthOverride(e.target.value)}
            className="rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm text-black dark:border-white/10 dark:bg-neutral-800 dark:text-white"
          >
            <option value="all">전체</option>
            {Array.from({ length: 12 }, (_, i) =>
              String(i + 1).padStart(2, "0"),
            ).map((m) => (
              <option key={m} value={m}>
                {Number(m)}월
              </option>
            ))}
          </select>
        </div>
        <CheckboxFilter
          label="사업부"
          options={divisions}
          selected={selectedDivisions}
          onChange={setSelectedDivisions}
        />
        <CheckboxFilter
          label="부서"
          options={departments}
          selected={selectedDepts}
          onChange={setSelectedDepts}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="계획 건수" value={kpi.total.toLocaleString()} color="blue" />
        <KpiCard label="달성" value={kpi.hit.toLocaleString()} color="green" />
        <KpiCard label="미달" value={kpi.miss.toLocaleString()} color="red" />
        <KpiCard label="달성률" value={pct(kpi.rate)} color="indigo" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="월간 생산계획 달성률"
          note="연도 필터 적용 · 월 필터 무시"
        >
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={monthlyTrend} margin={{ top: 16, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis
                dataKey="month"
                tick={{ fill: axisColor, fontSize: 13 }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={monthlyAxis.domain}
                ticks={monthlyAxis.ticks}
                tick={{ fill: axisColor, fontSize: 13 }}
                tickFormatter={labelPercent}
              />
              <Tooltip {...TOOLTIP_PROPS}
                formatter={(v, _n, item) => [
                  `${labelPercent(v)} (${labelNumber(item?.payload?.count ?? 0)}건)`,
                  "달성률",
                ]}
              />
              <Line
                dataKey="ratePct"
                name="달성률"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={{ r: 3 }}
              >
                <LabelList
                  dataKey="ratePct"
                  position="top"
                  fill={labelColor}
                  fontSize={12}
                  formatter={labelPercent}
                />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="부서별 생산계획 달성률"
          note="연도 필터 적용 · 월 필터 무시"
        >
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={deptTrend.data} margin={{ top: 16, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis
                dataKey="month"
                tick={{ fill: axisColor, fontSize: 13 }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={deptAxis.domain}
                ticks={deptAxis.ticks}
                tick={{ fill: axisColor, fontSize: 13 }}
                tickFormatter={labelPercent}
              />
              <Tooltip {...TOOLTIP_PROPS} formatter={labelPercent} />
              <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
              {deptTrend.depts.map((dept, i) => (
                <Line
                  key={dept}
                  dataKey={dept}
                  name={dept}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title={`공정별 생산계획 달성률 (하위 ${PROCESS_CHART_LIMIT})`}
          note="모든 필터 적용"
        >
          <ResponsiveContainer width="100%" height={420}>
            <BarChart
              data={processRate}
              layout="vertical"
              margin={{ right: 40 }}
            >
              <XAxis
                type="number"
                domain={[0, 100]}
                tick={{ fill: axisColor, fontSize: 13 }}
                tickFormatter={(v) => `${v}%`}
              />
              <YAxis
                type="category"
                dataKey="process"
                width={145}
                tick={{ fill: axisColor, fontSize: 12 }}
              />
              <Tooltip {...TOOLTIP_PROPS}
                formatter={(v, _n, item) => [
                  `${v}% (${item?.payload?.count ?? 0}건)`,
                  "달성률",
                ]}
              />
              <Bar dataKey="ratePct" name="달성률" fill="#38bdf8">
                <LabelList
                  dataKey="ratePct"
                  position="right"
                  fill={labelColor}
                  fontSize={12}
                  formatter={labelPercent}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="미달 유형별 분석"
          note={
            failTypeMode === "group"
              ? "모든 필터 적용 · 미달 건만 · 2024년부터 전 기간 비교 가능"
              : "모든 필터 적용 · 미달 건만 · 2025-08-18 이전은 영업요청/생산관리 구분 없음"
          }
          action={
            <div className="flex rounded-md border border-black/10 text-xs dark:border-white/10">
              {(
                [
                  ["group", "대분류"],
                  ["detail", "세부"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setFailTypeMode(mode)}
                  className={`px-2.5 py-1 first:rounded-l-md last:rounded-r-md transition-colors ${
                    failTypeMode === mode
                      ? "bg-foreground text-background"
                      : "text-foreground/60 hover:bg-black/5 dark:hover:bg-white/10"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          {failTypeBreakdown.length === 0 ? (
            <p className="py-16 text-center text-sm text-foreground/60">
              미달 건이 없습니다.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={420}>
              <PieChart>
                <Pie
                  data={failTypeBreakdown}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={130}
                  label={(props) => {
                    const { x, y, cx, name, value, index } = props as {
                      x: number;
                      y: number;
                      cx: number;
                      name: string;
                      value: number;
                      index: number;
                    };
                    // 작은 조각들은 지시선 끝이 거의 같은 자리에 몰려 글자가
                    // 겹친다. 목록이 비중 내림차순이라 작은 것들은 뒤에 모여
                    // 있으므로, 그 안에서의 순번만큼 아래로 밀어 떼어놓는다.
                    const offset =
                      smallSliceFrom >= 0 && index >= smallSliceFrom
                        ? (index - smallSliceFrom) * 15
                        : 0;
                    return (
                      <text
                        x={x}
                        y={y + offset}
                        fill={labelColor}
                        fontSize={13}
                        textAnchor={x > cx ? "start" : "end"}
                        dominantBaseline="central"
                      >
                        {`${name} ${labelPercent(value)}`}
                      </text>
                    );
                  }}
                >
                  {failTypeBreakdown.map((d, i) => (
                    <Cell
                      key={d.name}
                      fill={
                        FAIL_TYPE_COLORS[d.name] ??
                        SERIES_COLORS[i % SERIES_COLORS.length]
                      }
                    />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP_PROPS}
                  formatter={(v, _n, item) => [
                    `${labelPercent(v)} (${labelNumber(item?.payload?.count ?? 0)}건)`,
                    // 두 번째 값이 팝업에 표시되는 항목명. "비중" 이라고만
                    // 두면 어느 유형인지 알 수 없어 유형명을 그대로 쓴다.
                    String(item?.payload?.name ?? "비중"),
                  ]}
                />
                <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="rounded-lg border border-black/10 dark:border-white/10">
        <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
          <p className="text-sm font-semibold">
            미달 상세 ({kpi.miss.toLocaleString()}건
            {missDetail.length < kpi.miss
              ? ` 중 최근 ${missDetail.length}건`
              : ""}
            )
          </p>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            {/* sticky 헤더라 배경이 불투명해야 스크롤된 행이 비쳐 보이지 않는다. */}
            <thead className="sticky top-0 bg-neutral-100 dark:bg-neutral-800">
              <tr className="border-b border-black/10 text-center dark:border-white/10">
                <th className="px-3 py-2 font-medium">실적일</th>
                <th className="px-3 py-2 font-medium">부서</th>
                <th className="px-3 py-2 font-medium">공정</th>
                <th className="px-3 py-2 font-medium">품번</th>
                <th className="px-3 py-2 font-medium">계획</th>
                <th className="px-3 py-2 font-medium">실적</th>
                <th className="px-3 py-2 font-medium">미달유형</th>
                <th className="px-3 py-2 font-medium">미달사유</th>
              </tr>
            </thead>
            <tbody>
              {missDetail.map((r, i) => (
                <tr
                  key={i}
                  className="border-b border-black/5 dark:border-white/5"
                >
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {r.record_date}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {r.department ?? "-"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {r.process ?? "-"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {r.part_number ?? "-"}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {qty(r.plan_qty)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {qty(r.actual_qty)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {r.fail_type ?? "-"}
                  </td>
                  <td className="px-3 py-1.5 text-foreground/60">
                    {r.fail_reason ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CheckboxFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-foreground/60">{label}</span>
      <div className="flex flex-wrap gap-3 pt-1">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={selected.has(o)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(o);
                else next.delete(o);
                onChange(next);
              }}
            />
            {o}
          </label>
        ))}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          {note && <p className="text-xs text-foreground/50">{note}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

const KPI_COLOR_CLASSES = {
  blue: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950",
  green:
    "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950",
  red: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950",
  indigo:
    "border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950",
} as const;

const KPI_VALUE_COLOR_CLASSES = {
  blue: "text-blue-700 dark:text-blue-300",
  green: "text-green-700 dark:text-green-300",
  red: "text-red-700 dark:text-red-300",
  indigo: "text-indigo-700 dark:text-indigo-300",
} as const;

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: keyof typeof KPI_COLOR_CLASSES;
}) {
  return (
    <div
      className={`rounded-lg border p-4 text-center ${KPI_COLOR_CLASSES[color]}`}
    >
      <p className="text-sm text-foreground/60">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold ${KPI_VALUE_COLOR_CLASSES[color]}`}
      >
        {value}
      </p>
    </div>
  );
}
