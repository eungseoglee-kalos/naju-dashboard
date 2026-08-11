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

type BeamRecord = {
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
  spec: string | null;
  defect_type: string;
  qty_defect: number;
};

// 품질목표는 참고 화면에서 87,000 PPM 으로 고정돼 있다 (커넥터와 마찬가지로
// 실적에 따라 바뀌는 값이 아니라 회사가 정한 기준선).
const QUALITY_TARGET_PPM = 87000;

const INSPECTION_PROCESSES = new Set(["전자빔검사"]);
const NON_INSPECTION_PROCESSES = new Set([
  "전자빔세척",
  "전자빔절곡",
  "전자빔코일링",
  "전자빔프레스",
]);

const PROCESS_COLORS: Record<string, string> = {
  전자빔검사: "#2563eb",
  전자빔세척: "#f97316",
  전자빔절곡: "#6b7280",
  전자빔코일링: "#eab308",
  전자빔프레스: "#16a34a",
};
const PROCESS_ORDER = Object.keys(PROCESS_COLORS);

const DEFECT_TYPES = [
  "공정불량",
  "다리불량",
  "단선불량",
  "성형불량",
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
];

function ppm(defect: number, total: number): number | null {
  return total === 0 ? null : Math.round((defect / total) * 1_000_000);
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

export default function ElectronBeamQualityPage() {
  const [records, setRecords] = useState<BeamRecord[] | null>(null);
  const [defects, setDefects] = useState<DefectDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yearOverride, setYearOverride] = useState<string | null>(null);
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const isDark = useIsDark();
  const axisColor = isDark ? "#d4d4d4" : "#404040";
  const labelColor = isDark ? "#f5f5f5" : "#171717";

  useEffect(() => {
    Promise.all([
      fetchAll<BeamRecord>(
        "electron_beam_quality_records",
        "work_date, process, part_number, part_code, qty_total, qty_defect",
      ),
      fetchAll<DefectDetail>(
        "electron_beam_defect_details",
        "work_date, part_number, spec, defect_type, qty_defect",
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

  // 연도/월 필터를 무시하고 최근 24개월을 본다 -- 커넥터 대시보드와 같은 이유.
  const monthlyTrend = useMemo(() => {
    if (!records) return [];
    const byMonth = new Map<string, BeamRecord[]>();
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
        return row;
      });
  }, [records]);

  // 일간 차트는 연도/월 필터를 그대로 따른다.
  const dailyTrend = useMemo(() => {
    const byDate = new Map<string, BeamRecord[]>();
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

  // 참고 화면은 이 차트를 "형상별 생산 비율" 파이로 그렸고, 짧은 코드가
  // 아니라 품목 코드 전체(GWELE0031 등)로 구분한다.
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
    const byPart = new Map<string, { spec: string | null; perType: Map<string, number> }>();
    for (const r of filteredDefects) {
      if (!byPart.has(r.part_number)) {
        byPart.set(r.part_number, { spec: r.spec, perType: new Map() });
      }
      const entry = byPart.get(r.part_number)!;
      entry.perType.set(
        r.defect_type,
        (entry.perType.get(r.defect_type) ?? 0) + r.qty_defect,
      );
    }
    return Array.from(byPart.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([part, { spec, perType }]) => ({ part, spec, perType }));
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
        <h1 className="text-lg font-semibold">전자빔 품질실적</h1>
        <LastSyncBadge table="electron_beam_quality_records" />
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
        <p className="mb-1 text-sm font-semibold">전자빔 월간 불량률</p>
        <p className="mb-3 text-xs text-foreground/50">
          최근 24개월 · 공정별 PPM, 단위: PPM
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={monthlyTrend} margin={{ top: 20, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="month" tick={{ fill: axisColor, fontSize: 11 }} />
            <YAxis tick={{ fill: axisColor, fontSize: 11 }} tickFormatter={labelNumber} />
            <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
            <Legend wrapperStyle={{ color: axisColor, fontSize: 11 }} />
            {PROCESS_ORDER.map((proc) => (
              <Bar key={proc} dataKey={proc} name={proc} stackId="proc" fill={PROCESS_COLORS[proc]} />
            ))}
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
        <p className="mb-1 text-sm font-semibold">전자빔 일간 불량률</p>
        <p className="mb-3 text-xs text-foreground/50">
          선택한 기간 · 공정별 PPM, 단위: PPM
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={dailyTrend} margin={{ top: 20, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="date" tick={{ fill: axisColor, fontSize: 11 }} />
            <YAxis tick={{ fill: axisColor, fontSize: 11 }} tickFormatter={labelNumber} />
            <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
            <Legend wrapperStyle={{ color: axisColor, fontSize: 11 }} />
            {PROCESS_ORDER.map((proc) => (
              <Bar key={proc} dataKey={proc} name={proc} stackId="proc" fill={PROCESS_COLORS[proc]} />
            ))}
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
          <p className="mb-4 text-sm font-semibold">품목별 불량률 (PPM)</p>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={partDefectRate} margin={{ top: 20, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="part" tick={{ fill: axisColor, fontSize: 11 }} />
              <YAxis tick={{ fill: axisColor, fontSize: 11 }} tickFormatter={labelNumber} />
              <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
              <Bar dataKey="ppm" name="불량률(PPM)" fill="#0891b2">
                <LabelList dataKey="ppm" position="top" fill={labelColor} fontSize={10} formatter={labelNumber} />
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
          <p className="mb-4 text-sm font-semibold">품목별 생산 비율</p>
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
                        fontSize={11}
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
          <p className="text-sm font-semibold">전자빔 검사공정 세부 불량유형</p>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b border-black/10 text-left dark:border-white/10">
                <th className="px-3 py-2 font-medium">품목</th>
                <th className="px-3 py-2 font-medium">규격</th>
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
                    colSpan={DEFECT_TYPES.length + 2}
                    className="px-3 py-8 text-center text-foreground/50"
                  >
                    선택한 기간에 불량 기록이 없습니다.
                  </td>
                </tr>
              ) : (
                defectTable.map(({ part, spec, perType }) => (
                  <tr key={part} className="border-b border-black/5 dark:border-white/5">
                    <td className="px-3 py-1.5 font-medium">{part}</td>
                    <td className="px-3 py-1.5 text-foreground/60">{spec ?? ""}</td>
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
