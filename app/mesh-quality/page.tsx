"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  PieChart,
  Pie,
  Cell,
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

type MeshRecord = {
  work_date: string;
  process: string;
  part_number: string;
  part_code: string | null;
  qty_total: number;
  qty_defect: number;
};

type DefectDetail = {
  work_date: string;
  part_number: string;
  defect_type: string;
  qty_defect: number;
};

// 품질목표는 참고 화면에서 4,700 PPM 으로 고정돼 있다.
const QUALITY_TARGET_PPM = 4700;

const INSPECTION_PROCESSES = new Set(["출하검사"]);
const NON_INSPECTION_PROCESSES = new Set(["와이어컷팅"]);

const PROCESS_COLORS: Record<string, string> = {
  출하검사: "#2563eb",
  와이어컷팅: "#f97316",
};
const PROCESS_ORDER = Object.keys(PROCESS_COLORS);

const DEFECT_TYPES = [
  "DENT불량",
  "단선불량",
  "변색불량",
  "성형불량",
  "유격불량",
  "이물질",
  "크랙불량",
  "파손불량",
  "평탄도불량",
  "포장불량",
];

const PART_COLORS = [
  "#2563eb",
  "#f97316",
  "#6b7280",
  "#eab308",
  "#16a34a",
  "#7c3aed",
  "#ec4899",
  "#06b6d4",
  "#dc2626",
  "#0891b2",
  "#84cc16",
  "#a855f7",
];

function ppm(defect: number, total: number): number | null {
  return total === 0 ? null : Math.round((defect / total) * 1_000_000);
}

// 월간/일간 차트의 막대 맨 위에 합계를 보여주기 위한 값. 쌓인 막대의 실제
// 높이는 공정별 PPM들의 합이므로(각자 PPM을 구해 쌓는 방식), 그 합을 그대로
// 더해서 구한다.
function stackedTotal(row: Record<string, number | string | null>): number {
  return PROCESS_ORDER.reduce((sum, proc) => {
    const v = row[proc];
    return sum + (typeof v === "number" ? v : 0);
  }, 0);
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

export default function MeshQualityPage() {
  const [records, setRecords] = useState<MeshRecord[] | null>(null);
  const [defects, setDefects] = useState<DefectDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yearOverride, setYearOverride] = useState<string | null>(null);
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const isDark = useIsDark();
  const axisColor = isDark ? "#d4d4d4" : "#404040";
  const labelColor = isDark ? "#f5f5f5" : "#171717";

  useEffect(() => {
    Promise.all([
      fetchAll<MeshRecord>(
        "mesh_quality_records",
        "work_date, process, part_number, part_code, qty_total, qty_defect",
      ),
      fetchAll<DefectDetail>(
        "mesh_quality_defect_details",
        "work_date, part_number, defect_type, qty_defect",
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
      let sum = 0;
      let anyQty = false;
      for (const proc of procs) {
        const recs = filtered.filter((r) => r.process === proc);
        const total = recs.reduce((a, r) => a + r.qty_total, 0);
        if (total === 0) continue;
        anyQty = true;
        const defect = recs.reduce((a, r) => a + r.qty_defect, 0);
        sum += Math.round((defect / total) * 1_000_000);
      }
      return anyQty ? sum : null;
    };

    const processPpm = groupPpm(NON_INSPECTION_PROCESSES);
    const inspectionPpm = groupPpm(INSPECTION_PROCESSES);
    const combinedPpm = (processPpm ?? 0) + (inspectionPpm ?? 0);
    const achievementPct =
      combinedPpm === 0 ? null : Math.round((QUALITY_TARGET_PPM / combinedPpm) * 100);

    return { processPpm, inspectionPpm, achievementPct };
  }, [filtered]);

  // 연도/월 필터를 무시하고 최근 24개월을 본다 -- 다른 품질 대시보드와 같은 이유.
  const monthlyTrend = useMemo(() => {
    if (!records) return [];
    const byMonth = new Map<string, MeshRecord[]>();
    for (const r of records) {
      const key = r.work_date.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(r);
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-24)
      .map(([key, recs]) => {
        const row: Record<string, number | string | null> = {
          month: key.slice(2),
        };
        for (const proc of PROCESS_ORDER) {
          const procRecs = recs.filter((r) => r.process === proc);
          const total = procRecs.reduce((a, r) => a + r.qty_total, 0);
          const defect = procRecs.reduce((a, r) => a + r.qty_defect, 0);
          row[proc] = ppm(defect, total);
        }
        row.품질목표 = QUALITY_TARGET_PPM;
        row.합계 = stackedTotal(row);
        return row;
      });
  }, [records]);

  const dailyTrend = useMemo(() => {
    const byDate = new Map<string, MeshRecord[]>();
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
        for (const proc of PROCESS_ORDER) {
          const procRecs = recs.filter((r) => r.process === proc);
          const total = procRecs.reduce((a, r) => a + r.qty_total, 0);
          const defect = procRecs.reduce((a, r) => a + r.qty_defect, 0);
          row[proc] = ppm(defect, total);
        }
        row.품질목표 = QUALITY_TARGET_PPM;
        row.합계 = stackedTotal(row);
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
    const partNumbers = Array.from(new Set(filtered.map((r) => r.part_number)));
    const totalQty = filtered.reduce((a, r) => a + r.qty_total, 0);
    if (totalQty === 0) return [];
    return partNumbers
      .map((p) => {
        const qty = filtered
          .filter((r) => r.part_number === p)
          .reduce((a, r) => a + r.qty_total, 0);
        return { name: p, value: qty, pct: Math.round((qty / totalQty) * 1000) / 10 };
      })
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  const defectTable = useMemo(() => {
    const byPart = new Map<string, Map<string, number>>();
    for (const r of filteredDefects) {
      if (!byPart.has(r.part_number)) byPart.set(r.part_number, new Map());
      const perType = byPart.get(r.part_number)!;
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
        <h1 className="text-lg font-semibold">메시 품질실적</h1>
        <LastSyncBadge table="mesh_quality_records" />
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
        <p className="mb-1 text-sm font-semibold">메시 월간 불량률</p>
        <p className="mb-3 text-xs text-foreground/50">
          최근 24개월 · 공정별 PPM, 단위: PPM
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
        <p className="mb-1 text-sm font-semibold">메시 일간 불량률</p>
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
          {partShare.length === 0 ? (
            <p className="py-24 text-center text-sm text-foreground/60">
              데이터가 없습니다.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={partShare}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={92}
                  label={(props) => {
                    const { x, y, cx, name, payload } = props as {
                      x: number;
                      y: number;
                      cx: number;
                      name: string;
                      payload: { pct: number };
                    };
                    return (
                      <text
                        x={x}
                        y={y}
                        fill={labelColor}
                        fontSize={13}
                        textAnchor={x > cx ? "start" : "end"}
                        dominantBaseline="central"
                      >
                        {`${name} ${payload.pct}%`}
                      </text>
                    );
                  }}
                >
                  {partShare.map((d, i) => (
                    <Cell key={d.name} fill={PART_COLORS[i % PART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-black/10 dark:border-white/10">
        <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
          <p className="text-sm font-semibold">메시 출하검사공정 세부 불량유형</p>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b border-black/10 text-left dark:border-white/10">
                <th className="px-3 py-2 font-medium">품목</th>
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
