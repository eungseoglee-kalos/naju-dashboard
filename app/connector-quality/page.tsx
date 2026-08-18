"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { TOOLTIP_PROPS } from "@/lib/chart";
import { useIsDark } from "@/lib/use-is-dark";
import { periodDefaults } from "@/lib/period";
import { labelNumber } from "@/lib/format";
import LastSyncBadge from "@/components/dashboard/LastSyncBadge";

type ConnectorRecord = {
  work_date: string;
  process: string;
  part_code: string | null;
  qty_total: number;
  qty_defect: number;
};

type DefectDetail = {
  work_date: string;
  part_code: string | null;
  defect_type: string;
  qty_defect: number;
};

// 품질목표는 원본 엑셀의 "커넥터품질목표" 시트에서도 매달 50,000 으로 고정돼
// 있다 (실적에 따라 바뀌는 값이 아니라 회사가 정한 기준선). 매번 그 시트의
// 복잡한 피벗 구조를 다시 읽는 대신 그 값을 그대로 상수로 둔다.
const QUALITY_TARGET_PPM = 50000;

const INSPECTION_PROCESSES = new Set(["커넥터 검사1", "커넥터 검사2"]);
const NON_INSPECTION_PROCESSES = new Set([
  "커넥터 세척",
  "커넥터절단",
  "커넥터홀가공",
]);

const PROCESS_COLORS: Record<string, string> = {
  "커넥터 검사1": "#16a34a",
  "커넥터 검사2": "#2563eb",
  "커넥터 세척": "#eab308",
  커넥터절단: "#f97316",
  커넥터홀가공: "#6b7280",
};
const PROCESS_ORDER = Object.keys(PROCESS_COLORS);

const DEFECT_TYPES = [
  "공정불량",
  "성형불량",
  "커넥터 길이불량",
  "커넥터 외경불량",
  "커넥터 외관불량",
  "커넥터 홀깊이불량",
  "커넥터 홀위치 불량",
  "커넥터 홀크기불량",
  "크랙불량",
  "포장불량",
];

const PART_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f97316",
  "#7c3aed",
  "#ec4899",
  "#eab308",
  "#06b6d4",
  "#dc2626",
  "#6b7280",
  "#0891b2",
  "#84cc16",
  "#a855f7",
];

function ppm(defect: number, total: number): number | null {
  return total === 0 ? null : Math.round((defect / total) * 1_000_000);
}

// 당월 기준 과거 count개월의 "YYYY-MM" 키 목록(오래된 순). 실제 마지막
// 실적이 당월보다 오래됐어도 항상 오늘 날짜 기준으로 채운다.
function pastMonthKeys(count: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const supabase = createClient();
  const pageSize = 1000;
  let from = 0;
  let all: T[] = [];

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order("work_date", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    all = all.concat(data as T[]);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export default function ConnectorQualityPage() {
  const [records, setRecords] = useState<ConnectorRecord[] | null>(null);
  const [defects, setDefects] = useState<DefectDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yearOverride, setYearOverride] = useState<string | null>(null);
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const isDark = useIsDark();
  const axisColor = isDark ? "#d4d4d4" : "#404040";
  const labelColor = isDark ? "#f5f5f5" : "#171717";

  useEffect(() => {
    Promise.all([
      fetchAll<ConnectorRecord>(
        "connector_quality_records",
        "work_date, process, part_code, qty_total, qty_defect",
      ),
      fetchAll<DefectDetail>(
        "connector_defect_details",
        "work_date, part_code, defect_type, qty_defect",
      ),
    ])
      .then(([r, d]) => {
        setRecords(r);
        setDefects(d);
      })
      .catch((e) => setError(e.message ?? "데이터를 불러오지 못했습니다."));
  }, []);

  const years = useMemo(() => {
    if (!records) return [];
    return Array.from(new Set(records.map((r) => r.work_date.slice(0, 4)))).sort();
  }, [records]);

  const defaults = useMemo(
    () => periodDefaults(records?.map((r) => r.work_date) ?? []),
    [records],
  );
  const year = yearOverride ?? defaults.year;
  const month = monthOverride ?? defaults.month;

  const filtered = useMemo(() => {
    if (!records) return [];
    return records.filter((r) => {
      if (year !== "all" && r.work_date.slice(0, 4) !== year) return false;
      if (month !== "all" && r.work_date.slice(5, 7) !== month) return false;
      return true;
    });
  }, [records, year, month]);

  const filteredDefects = useMemo(() => {
    if (!defects) return [];
    return defects.filter((r) => {
      if (year !== "all" && r.work_date.slice(0, 4) !== year) return false;
      if (month !== "all" && r.work_date.slice(5, 7) !== month) return false;
      return true;
    });
  }, [defects, year, month]);

  const kpi = useMemo(() => {
    // 참고 화면과 대조해보면 공정/검사 불량률은 "합쳐서 하나의 비율"이 아니라,
    // 아래 월간/일간 차트처럼 공정별로 각자 PPM을 구한 뒤 그 값들을 더한
    // 것이다 (실적이 없는 공정은 0으로 취급하되, 그룹 전체에 실적이 하나도
    // 없으면 "-"를 보여줘야 하므로 null로 구분한다).
    const groupPpm = (procs: Set<string>) => {
      // 공정마다 먼저 반올림한 값을 더하면 원본 엑셀의 합계와 반올림 오차로
      // 어긋날 수 있어서, 반올림 전 비율을 다 더한 뒤 마지막에 한 번만 반올림한다.
      let sum = 0;
      let anyQty = false;
      for (const proc of procs) {
        const recs = filtered.filter((r) => r.process === proc);
        const total = recs.reduce((a, r) => a + r.qty_total, 0);
        if (total === 0) continue;
        anyQty = true;
        const defect = recs.reduce((a, r) => a + r.qty_defect, 0);
        sum += (defect / total) * 1_000_000;
      }
      return anyQty ? Math.round(sum) : null;
    };

    const processPpm = groupPpm(NON_INSPECTION_PROCESSES);
    const inspectionPpm = groupPpm(INSPECTION_PROCESSES);
    // 달성률은 검사불량률만이 아니라 공정+검사를 합친 값 기준이다
    // (품질목표 ÷ (공정불량률+검사불량률) x 100).
    const combinedPpm = (processPpm ?? 0) + (inspectionPpm ?? 0);
    const achievementPct =
      combinedPpm === 0 ? null : Math.round((QUALITY_TARGET_PPM / combinedPpm) * 100);

    return { processPpm, inspectionPpm, achievementPct };
  }, [filtered]);

  // 연도/월 필터를 무시하고 당월 기준 과거 12개월을 본다 -- 실적이 없는
  // 달도 빈 칸으로 그대로 채워서 항상 오늘 기준 12개월 폭을 유지한다.
  const monthlyTrend = useMemo(() => {
    if (!records) return [];
    const byMonth = new Map<string, ConnectorRecord[]>();
    for (const r of records) {
      const key = r.work_date.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(r);
    }
    return pastMonthKeys(12).map((key) => {
        const recs = byMonth.get(key) ?? [];
        const row: Record<string, number | string | null> = {
          month: key.slice(2),
        };
        let totalRatio = 0;
        for (const proc of PROCESS_ORDER) {
          const procRecs = recs.filter((r) => r.process === proc);
          const total = procRecs.reduce((a, r) => a + r.qty_total, 0);
          const defect = procRecs.reduce((a, r) => a + r.qty_defect, 0);
          row[proc] = ppm(defect, total);
          if (total > 0) totalRatio += (defect / total) * 1_000_000;
        }
        row.품질목표 = QUALITY_TARGET_PPM;
        // 공정마다 반올림한 값을 더하면 원본 엑셀 합계와 반올림 오차로 어긋날
        // 수 있어서, 반올림 전 비율을 다 더한 뒤 마지막에 한 번만 반올림한다.
        row.합계 = Math.round(totalRatio);
        return row;
      });
  }, [records]);

  // 일간 차트는 연도/월 필터를 그대로 따른다 -- "전체"를 고르면 일 단위로는
  // 너무 촘촘해지니, 특정 달을 골랐을 때 보라는 취지의 차트다.
  const dailyTrend = useMemo(() => {
    const byDate = new Map<string, ConnectorRecord[]>();
    for (const r of filtered) {
      if (!byDate.has(r.work_date)) byDate.set(r.work_date, []);
      byDate.get(r.work_date)!.push(r);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, recs]) => {
        const row: Record<string, number | string | null> = {
          date: date.slice(5),
        };
        let totalRatio = 0;
        for (const proc of PROCESS_ORDER) {
          const procRecs = recs.filter((r) => r.process === proc);
          const total = procRecs.reduce((a, r) => a + r.qty_total, 0);
          const defect = procRecs.reduce((a, r) => a + r.qty_defect, 0);
          row[proc] = ppm(defect, total);
          if (total > 0) totalRatio += (defect / total) * 1_000_000;
        }
        row.품질목표 = QUALITY_TARGET_PPM;
        row.합계 = Math.round(totalRatio);
        return row;
      });
  }, [filtered]);

  const partCodes = useMemo(() => {
    if (!records) return [];
    return Array.from(
      new Set(records.map((r) => r.part_code).filter((p): p is string => !!p)),
    ).sort();
  }, [records]);

  const partDefectRate = useMemo(() => {
    return partCodes
      .map((code) => {
        const recs = filtered.filter((r) => r.part_code === code);
        const total = recs.reduce((a, r) => a + r.qty_total, 0);
        const defect = recs.reduce((a, r) => a + r.qty_defect, 0);
        return { part: code, ppm: ppm(defect, total), 품질목표: QUALITY_TARGET_PPM };
      })
      .filter((d) => d.ppm !== null && d.ppm > 0);
  }, [partCodes, filtered]);

  const partShare = useMemo(() => {
    const totalQty = filtered.reduce((a, r) => a + r.qty_total, 0);
    if (totalQty === 0) return { row: {}, parts: [] as string[] };
    const parts = partCodes
      .map((code) => ({
        code,
        qty: filtered
          .filter((r) => r.part_code === code)
          .reduce((a, r) => a + r.qty_total, 0),
      }))
      .filter((d) => d.qty > 0)
      .sort((a, b) => b.qty - a.qty);

    const row: Record<string, number | string> = { name: "생산 비율" };
    for (const p of parts) {
      row[p.code] = Math.round((p.qty / totalQty) * 1000) / 10;
    }
    return { row, parts: parts.map((p) => p.code) };
  }, [partCodes, filtered]);

  const defectTable = useMemo(() => {
    const byPart = new Map<string, Map<string, number>>();
    for (const r of filteredDefects) {
      const code = r.part_code ?? r.defect_type;
      if (!byPart.has(code)) byPart.set(code, new Map());
      const perType = byPart.get(code)!;
      perType.set(r.defect_type, (perType.get(r.defect_type) ?? 0) + r.qty_defect);
    }
    return Array.from(byPart.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([part, perType]) => ({ part, perType }));
  }, [filteredDefects]);

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (!records || !defects) {
    return <p className="text-sm text-foreground/60">불러오는 중...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">커넥터 품질실적</h1>
        <LastSyncBadge table="connector_quality_records" />
      </div>

      <div className="flex flex-wrap items-end gap-4">
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
            {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map(
              (m) => (
                <option key={m} value={m}>
                  {Number(m)}월
                </option>
              ),
            )}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="공정 불량률 (PPM)"
          value={kpi.processPpm === null ? "-" : kpi.processPpm.toLocaleString()}
          color="blue"
        />
        <KpiCard
          label="검사 불량률 (PPM)"
          value={kpi.inspectionPpm === null ? "-" : kpi.inspectionPpm.toLocaleString()}
          color="red"
        />
        <KpiCard label="품질목표 (PPM)" value={QUALITY_TARGET_PPM.toLocaleString()} color="amber" />
        <KpiCard
          label="품질목표 달성률"
          value={kpi.achievementPct === null ? "-" : `${kpi.achievementPct}%`}
          color="green"
        />
      </div>

      <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
        <p className="mb-1 text-sm font-semibold">커넥터 월간 불량률</p>
        <p className="mb-3 text-xs text-foreground/50">
          당월 기준 과거 12개월 · 공정별 PPM, 단위: PPM
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={monthlyTrend} margin={{ top: 20, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="month" tick={{ fill: axisColor, fontSize: 13 }} />
            <YAxis tick={{ fill: axisColor, fontSize: 13 }} tickFormatter={labelNumber} />
            <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
            <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
            {PROCESS_ORDER.map((proc) => (
              <Bar key={proc} dataKey={proc} name={proc} stackId="proc" fill={PROCESS_COLORS[proc]} />
            ))}
            {/* 쌓인 막대 맨 위에 합계를 보여주기 위한 투명 선. 막대로는 값이
                0인 지점에서 라벨 자체가 안 그려져서, 대신 "합계" 값 그대로를
                찍는 선(보이지는 않게)에 라벨만 얹는다 -- 그 y 좌표가 곧 쌓인
                막대의 맨 위다. */}
            <Line dataKey="합계" name="합계" stroke="none" dot={false} legendType="none" isAnimationActive={false}>
              <LabelList
                dataKey="합계"
                position="top"
                fill={labelColor}
                fontSize={13}
                fontWeight={700}
                formatter={labelNumber}
              />
            </Line>
            <Line
              dataKey="품질목표"
              name="품질목표"
              stroke="#dc2626"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
        <p className="mb-1 text-sm font-semibold">커넥터 일간 불량률</p>
        <p className="mb-3 text-xs text-foreground/50">
          선택한 기간 · 공정별 PPM, 단위: PPM
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={dailyTrend} margin={{ top: 20, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="date" tick={{ fill: axisColor, fontSize: 13 }} />
            <YAxis tick={{ fill: axisColor, fontSize: 13 }} tickFormatter={labelNumber} />
            <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
            <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
            {PROCESS_ORDER.map((proc) => (
              <Bar key={proc} dataKey={proc} name={proc} stackId="proc" fill={PROCESS_COLORS[proc]} />
            ))}
            {/* 쌓인 막대 맨 위에 합계를 보여주기 위한 투명 선. 막대로는 값이
                0인 지점에서 라벨 자체가 안 그려져서, 대신 "합계" 값 그대로를
                찍는 선(보이지는 않게)에 라벨만 얹는다 -- 그 y 좌표가 곧 쌓인
                막대의 맨 위다. */}
            <Line dataKey="합계" name="합계" stroke="none" dot={false} legendType="none" isAnimationActive={false}>
              <LabelList
                dataKey="합계"
                position="top"
                fill={labelColor}
                fontSize={13}
                fontWeight={700}
                formatter={labelNumber}
              />
            </Line>
            <Line
              dataKey="품질목표"
              name="품질목표"
              stroke="#dc2626"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
          <p className="mb-4 text-sm font-semibold">품번별 불량률 (PPM)</p>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={partDefectRate} margin={{ top: 20, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="part" tick={{ fill: axisColor, fontSize: 13 }} />
              <YAxis tick={{ fill: axisColor, fontSize: 13 }} tickFormatter={labelNumber} />
              <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
              <Bar dataKey="ppm" name="불량률(PPM)" fill="#0891b2">
                <LabelList dataKey="ppm" position="top" fill={labelColor} fontSize={12} formatter={labelNumber} />
              </Bar>
              <Line
                dataKey="품질목표"
                name="품질목표"
                stroke="#dc2626"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
          <p className="mb-4 text-sm font-semibold">품번별 생산 비율</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={[partShare.row]} layout="vertical" margin={{ top: 20 }}>
              <XAxis type="number" domain={[0, 100]} tick={{ fill: axisColor, fontSize: 13 }} />
              <YAxis type="category" dataKey="name" hide />
              <Tooltip {...TOOLTIP_PROPS} />
              <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
              {partShare.parts.map((code, i) => (
                <Bar key={code} dataKey={code} name={code} stackId="share" fill={PART_COLORS[i % PART_COLORS.length]}>
                  <LabelList
                    dataKey={code}
                    position="center"
                    fill="#ffffff"
                    fontSize={12}
                    formatter={(v: unknown) => (Number(v) >= 3 ? `${v}%` : "")}
                  />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-black/10 dark:border-white/10">
        <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
          <p className="text-sm font-semibold">커넥터 검사공정 세부 불량유형</p>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b border-black/10 text-left dark:border-white/10">
                <th className="px-3 py-2 font-medium">품번</th>
                {DEFECT_TYPES.map((t) => (
                  <th key={t} className="px-3 py-2 text-center font-medium">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {defectTable.length === 0 ? (
                <tr>
                  <td
                    colSpan={DEFECT_TYPES.length + 1}
                    className="px-3 py-8 text-center text-foreground/50"
                  >
                    선택한 기간에 불량 기록이 없습니다.
                  </td>
                </tr>
              ) : (
                defectTable.map(({ part, perType }) => (
                  <tr key={part} className="border-b border-black/5 dark:border-white/5">
                    <td className="px-3 py-1.5 font-medium">{part}</td>
                    {DEFECT_TYPES.map((t) => (
                      <td key={t} className="px-3 py-1.5 text-center">
                        {perType.get(t)?.toLocaleString() ?? ""}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const KPI_COLOR_CLASSES = {
  blue: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950",
  green: "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950",
  red: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950",
  amber: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
} as const;

const KPI_VALUE_COLOR_CLASSES = {
  blue: "text-blue-700 dark:text-blue-300",
  green: "text-green-700 dark:text-green-300",
  red: "text-red-700 dark:text-red-300",
  amber: "text-amber-700 dark:text-amber-300",
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
    <div className={`rounded-lg border p-4 text-center ${KPI_COLOR_CLASSES[color]}`}>
      <p className="text-sm text-foreground/60">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${KPI_VALUE_COLOR_CLASSES[color]}`}>
        {value}
      </p>
    </div>
  );
}
