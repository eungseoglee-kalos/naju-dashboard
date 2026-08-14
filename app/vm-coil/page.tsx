"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
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
import { TOOLTIP_PROPS } from "@/lib/chart";
import { useIsDark } from "@/lib/use-is-dark";
import LastSyncBadge from "@/components/dashboard/LastSyncBadge";
import { periodDefaults } from "@/lib/period";
import { labelNumber, labelPercent } from "@/lib/format";

type Shipment = {
  ship_date: string;
  part_number: string;
  category: string;
  maker: string;
  weight_kg: number;
};

type Backlog = { category: string; weight_kg: number };

const COIL = "증착코일";
const MATERIAL = "증착재";
const KBM = "KBM";
const OUTSOURCED = "외주";

const COLOR_KBM = "#1f77b4";
const COLOR_OUT = "#ef7d2f";
const COLOR_TOTAL = "#1a7a3c";
const COLOR_BACKLOG = "#ef7d2f";
const COLOR_FORECAST = "#1a7a3c";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const TREND_MONTHS = 12;

function sum(rows: { weight_kg: number }[]) {
  return rows.reduce((acc, r) => acc + (Number(r.weight_kg) || 0), 0);
}

/** kg -> ton, 소수 1자리. 원 보고서가 코일은 ton, 증착재는 kg 로 읽는다. */
function ton(kg: number) {
  return Math.round(kg / 100) / 10;
}

function kg(v: number) {
  return Math.round(v);
}

function monthlySeries(
  rows: Shipment[],
  category: string,
  months: string[],
  toUnit: (v: number) => number,
) {
  const scoped = rows.filter((r) => r.category === category);
  return months.map((m) => {
    const ms = scoped.filter((r) => r.ship_date.slice(0, 7) === m);
    const k = toUnit(sum(ms.filter((r) => r.maker === KBM)));
    const o = toUnit(sum(ms.filter((r) => r.maker === OUTSOURCED)));
    return {
      month: `${Number(m.slice(5, 7))}월`,
      KBM: k || null,
      외주: o || null,
      합계: k + o || null,
    };
  });
}

function makerRatio(rows: Shipment[], category: string) {
  const scoped = rows.filter((r) => r.category === category);
  const total = sum(scoped);
  if (total === 0) return [];
  return [KBM, OUTSOURCED]
    .map((m) => {
      const v = sum(scoped.filter((r) => r.maker === m));
      return { name: m, value: v, pct: Math.round((v / total) * 1000) / 10 };
    })
    .filter((d) => d.value > 0);
}

async function fetchAll<T>(table: string, columns: string, order: string) {
  const supabase = createClient();
  const pageSize = 1000;

  const { count, error: countError } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (countError) throw countError;
  if (!count) return [] as T[];

  const ranges: [number, number][] = [];
  for (let from = 0; from < count; from += pageSize) {
    ranges.push([from, Math.min(from + pageSize, count) - 1]);
  }

  const pages = await Promise.all(
    ranges.map(async ([from, to]) => {
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .order(order, { ascending: true })
        .range(from, to);
      if (error) throw error;
      return (data ?? []) as T[];
    }),
  );

  return pages.flat();
}

export default function VmCoilPage() {
  const [shipments, setShipments] = useState<Shipment[] | null>(null);
  const [backlog, setBacklog] = useState<Backlog[]>([]);
  const [error, setError] = useState<string | null>(null);
  // 데이터가 있는 마지막 달로 열되, 사용자가 고르면 그 선택을 따른다
  // ("전체"도 유효한 선택이므로 null 만 "아직 안 고름"을 뜻한다).
  const [yearOverride, setYearOverride] = useState<string | null>(null);
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const isDark = useIsDark();
  const axisColor = isDark ? "#d4d4d4" : "#404040";
  const labelColor = isDark ? "#f5f5f5" : "#171717";

  useEffect(() => {
    Promise.all([
      fetchAll<Shipment>(
        "vm_shipments",
        "ship_date, part_number, category, maker, weight_kg",
        "ship_date",
      ),
      fetchAll<Backlog>("vm_backlog", "category, weight_kg", "id"),
    ])
      .then(([s, b]) => {
        setShipments(s);
        setBacklog(b);
      })
      .catch((e) => setError(e.message ?? "데이터를 불러오지 못했습니다."));
  }, []);

  const years = useMemo(() => {
    if (!shipments) return [];
    return Array.from(
      new Set(shipments.map((r) => r.ship_date.slice(0, 4))),
    ).sort();
  }, [shipments]);

  const lastShipDate = useMemo(() => {
    if (!shipments || shipments.length === 0) return null;
    return shipments.reduce(
      (max, r) => (r.ship_date > max ? r.ship_date : max),
      shipments[0].ship_date,
    );
  }, [shipments]);

  const defaults = useMemo(
    () => periodDefaults(shipments?.map((r) => r.ship_date) ?? []),
    [shipments],
  );
  const year = yearOverride ?? defaults.year;
  const month = monthOverride ?? defaults.month;

  // 기간 필터를 적용한 집합. KPI와 외주비율이 쓴다.
  const filtered = useMemo(() => {
    if (!shipments) return [];
    return shipments.filter((r) => {
      if (year !== "all" && r.ship_date.slice(0, 4) !== year) return false;
      if (month !== "all" && r.ship_date.slice(5, 7) !== month) return false;
      return true;
    });
  }, [shipments, year, month]);

  // KPI는 증착코일만 센다. 원 보고서의 254.7 ton / 32.3% 가 증착재를 뺀 값이다.
  const kpi = useMemo(() => {
    const coil = filtered.filter((r) => r.category === COIL);
    const total = sum(coil);
    const kbm = sum(coil.filter((r) => r.maker === KBM));
    const out = sum(coil.filter((r) => r.maker === OUTSOURCED));
    return {
      total: ton(total),
      kbm: ton(kbm),
      out: ton(out),
      kbmPct: total === 0 ? 0 : Math.round((kbm / total) * 1000) / 10,
      outPct: total === 0 ? 0 : Math.round((out / total) * 1000) / 10,
    };
  }, [filtered]);

  // 연도가 x축이므로 기간 필터를 타지 않는다.
  const yearly = useMemo(() => {
    if (!shipments) return [];
    const coil = shipments.filter((r) => r.category === COIL);
    return years.map((y) => {
      const ys = coil.filter((r) => r.ship_date.slice(0, 4) === y);
      const k = ton(sum(ys.filter((r) => r.maker === KBM)));
      const o = ton(sum(ys.filter((r) => r.maker === OUTSOURCED)));
      return { year: `${y}년`, KBM: k || null, 외주: o || null, 합계: k + o || null };
    });
  }, [shipments, years]);

  // 연도를 고르면 그 해 12개월, 아니면 최신 데이터 기준 최근 12개월.
  const trendMonths = useMemo(() => {
    if (year !== "all") {
      return MONTHS.map((m) => `${year}-${String(m).padStart(2, "0")}`);
    }
    if (!lastShipDate) return [];
    const out: string[] = [];
    const [ly, lm] = [
      Number(lastShipDate.slice(0, 4)),
      Number(lastShipDate.slice(5, 7)),
    ];
    for (let i = TREND_MONTHS - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(ly, lm - 1 - i, 1));
      out.push(
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      );
    }
    return out;
  }, [year, lastShipDate]);

  const coilMonthly = useMemo(
    () => monthlySeries(shipments ?? [], COIL, trendMonths, ton),
    [shipments, trendMonths],
  );
  const materialMonthly = useMemo(
    () => monthlySeries(shipments ?? [], MATERIAL, trendMonths, kg),
    [shipments, trendMonths],
  );

  // 당월 = 데이터의 마지막 달. 예상출하량은 이미 나간 양에 남은 수주를 더한 값.
  const forecast = useMemo(() => {
    if (!shipments || !lastShipDate) return [];
    const currentMonth = lastShipDate.slice(0, 7);
    return [COIL, MATERIAL].map((c) => {
      const shipped = sum(
        shipments.filter(
          (r) => r.category === c && r.ship_date.slice(0, 7) === currentMonth,
        ),
      );
      const remaining = sum(backlog.filter((r) => r.category === c));
      return {
        name: c,
        출하량: kg(shipped),
        수주잔량: kg(remaining),
        예상출하량: kg(shipped + remaining),
      };
    });
  }, [shipments, backlog, lastShipDate]);

  // 선택 연도와 전년을 월별로 나란히 두고 증감율을 얹는다.
  const yoy = useMemo(() => {
    if (!shipments || years.length === 0) return { data: [], pair: [] };
    const target = year !== "all" ? year : years[years.length - 1];
    const prev = String(Number(target) - 1);
    if (!years.includes(prev)) return { data: [], pair: [] };

    const coil = shipments.filter((r) => r.category === COIL);
    const data = MONTHS.map((m) => {
      const key = String(m).padStart(2, "0");
      const at = (y: string) =>
        ton(sum(coil.filter((r) => r.ship_date.slice(0, 7) === `${y}-${key}`)));
      const p = at(prev);
      const t = at(target);
      return {
        month: `${m}월`,
        [prev]: p || null,
        [target]: t || null,
        증감율: p === 0 ? null : Math.round(((t - p) / p) * 100),
      };
    });
    return { data, pair: [prev, target] };
  }, [shipments, years, year]);

  const coilRatio = useMemo(() => makerRatio(filtered, COIL), [filtered]);

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (!shipments) {
    return <p className="text-sm text-foreground/60">불러오는 중...</p>;
  }

  const periodNote =
    year === "all"
      ? "전 기간"
      : month === "all"
        ? `${year}년`
        : `${year}년 ${Number(month)}월`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">진공증착 월별 생산실적</h1>
        <div className="text-right">
          {lastShipDate && (
            <p className="text-xs text-foreground/60">
              ERP 최종 출하일 {lastShipDate}
            </p>
          )}
          <LastSyncBadge table="vm_shipments" />
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div>
          <label className="mb-1 block text-xs text-foreground/60">
            년(출고일자)
          </label>
          <select
            value={year}
            onChange={(e) => setYearOverride(e.target.value)}
            className="rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm text-black dark:border-white/10 dark:bg-neutral-800 dark:text-white"
          >
            <option value="all">전체</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/60">
            개월(출고일자)
          </label>
          <select
            value={month}
            onChange={(e) => setMonthOverride(e.target.value)}
            className="rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm text-black dark:border-white/10 dark:bg-neutral-800 dark:text-white"
          >
            <option value="all">전체</option>
            {MONTHS.map((m) => (
              <option key={m} value={String(m).padStart(2, "0")}>
                {m}월
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="전체 출하 중량" value={`${kpi.total}`} unit="ton" tone="blue" />
        <KpiCard label="KBM생산중량" value={`${kpi.kbm}`} unit="ton" tone="pink" />
        <KpiCard label="외주생산중량" value={`${kpi.out}`} unit="ton" tone="amber" />
        <KpiCard label="KBM생산점유율" value={`${kpi.kbmPct}%`} tone="emerald" />
        <KpiCard label="외주생산점유율" value={`${kpi.outPct}%`} tone="violet" />
      </div>
      <p className="-mt-4 text-xs text-foreground/50">
        KPI와 외주비율은 증착재를 제외한 <strong>증착코일</strong> 기준 ·{" "}
        {periodNote}
      </p>

      {/* 좌 2 : 우 1 의 3행. 왼쪽은 12개월/전년비교처럼 가로로 긴 차트, 오른쪽은
          항목이 두어 개뿐인 요약. 같은 행의 카드 높이를 맞추려고 차트 높이는
          320 으로 통일했다. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ChartCard
            title="증착코일 월간 출하량 (ton)"
            note={
              year === "all" ? "최근 12개월 · 월 필터 무시" : `${year}년 · 월 필터 무시`
            }
          >
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={coilMonthly} margin={{ top: 20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="month" tick={{ fill: axisColor, fontSize: 13 }} />
                <YAxis
                  tick={{ fill: axisColor, fontSize: 13 }}
                  tickFormatter={labelNumber}
                />
                <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
                <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
                <Bar dataKey="KBM" fill={COLOR_KBM}>
                  <LabelList dataKey="KBM" position="top" fill={labelColor} fontSize={11} formatter={labelNumber} />
                </Bar>
                <Bar dataKey="외주" fill={COLOR_OUT}>
                  <LabelList dataKey="외주" position="top" fill={labelColor} fontSize={11} formatter={labelNumber} />
                </Bar>
                <Line dataKey="합계" stroke={COLOR_TOTAL} strokeWidth={2} dot={{ r: 3 }} connectNulls>
                  <LabelList dataKey="합계" position="top" fill={labelColor} fontSize={11} formatter={labelNumber} />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <ChartCard title="증착코일 연간 출하량 (ton)" note="기간 필터 무시">
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={yearly} margin={{ top: 20, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="year" tick={{ fill: axisColor, fontSize: 13 }} />
              <YAxis
                tick={{ fill: axisColor, fontSize: 13 }}
                tickFormatter={labelNumber}
              />
              <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
              <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
              <Bar dataKey="KBM" fill={COLOR_KBM}>
                <LabelList dataKey="KBM" position="top" fill={labelColor} fontSize={12} formatter={labelNumber} />
              </Bar>
              <Bar dataKey="외주" fill={COLOR_OUT}>
                <LabelList dataKey="외주" position="top" fill={labelColor} fontSize={12} formatter={labelNumber} />
              </Bar>
              <Line dataKey="합계" stroke={COLOR_TOTAL} strokeWidth={2} dot={{ r: 3 }} connectNulls>
                <LabelList dataKey="합계" position="top" fill={labelColor} fontSize={12} formatter={labelNumber} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="xl:col-span-2">
          <ChartCard
            title="증착코일 전년 대비 생산량 증감현황 (ton)"
            note={
              yoy.pair.length === 2
                ? `${yoy.pair[0]}년 vs ${yoy.pair[1]}년`
                : "비교할 전년 데이터가 없습니다"
            }
          >
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={yoy.data} margin={{ top: 24, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="month" tick={{ fill: axisColor, fontSize: 13 }} />
                <YAxis yAxisId="left" tick={{ fill: axisColor, fontSize: 13 }} tickFormatter={labelNumber} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: axisColor, fontSize: 13 }} tickFormatter={labelPercent} />
                <Tooltip {...TOOLTIP_PROPS} />
                <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
                {yoy.pair.map((y, i) => (
                  <Bar key={y} yAxisId="left" dataKey={y} name={`${y}년`} fill={i === 0 ? COLOR_OUT : COLOR_KBM}>
                    <LabelList dataKey={y} position="top" fill={labelColor} fontSize={11} formatter={labelNumber} />
                  </Bar>
                ))}
                <Line yAxisId="right" dataKey="증감율" stroke={COLOR_TOTAL} strokeWidth={2} dot={{ r: 3 }} connectNulls>
                  <LabelList dataKey="증감율" position="top" fill={labelColor} fontSize={11} formatter={labelPercent} />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <ChartCard title="당월 예상 출하량 (kg)" note={`${lastShipDate?.slice(0, 7) ?? "-"} 기준 · 출하량 + 수주잔량`}>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={forecast} margin={{ top: 24, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" tick={{ fill: axisColor, fontSize: 13 }} />
              <YAxis tick={{ fill: axisColor, fontSize: 13 }} tickFormatter={labelNumber} />
              <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
              <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
              <Bar dataKey="출하량" fill={COLOR_KBM}>
                <LabelList dataKey="출하량" position="top" fill={labelColor} fontSize={12} formatter={labelNumber} />
              </Bar>
              <Bar dataKey="수주잔량" fill={COLOR_BACKLOG}>
                <LabelList dataKey="수주잔량" position="top" fill={labelColor} fontSize={12} formatter={labelNumber} />
              </Bar>
              <Bar dataKey="예상출하량" fill={COLOR_FORECAST}>
                <LabelList dataKey="예상출하량" position="top" fill={labelColor} fontSize={12} formatter={labelNumber} />
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="xl:col-span-2">
          <ChartCard
            title="증착재 월간 출하량 (kg)"
            note={
              year === "all" ? "최근 12개월 · 월 필터 무시" : `${year}년 · 월 필터 무시`
            }
          >
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={materialMonthly} margin={{ top: 20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="month" tick={{ fill: axisColor, fontSize: 13 }} />
                <YAxis tick={{ fill: axisColor, fontSize: 13 }} tickFormatter={labelNumber} />
                <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
                <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
                <Bar dataKey="KBM" fill={COLOR_KBM}>
                  <LabelList dataKey="KBM" position="top" fill={labelColor} fontSize={11} formatter={labelNumber} />
                </Bar>
                <Bar dataKey="외주" fill={COLOR_OUT}>
                  <LabelList dataKey="외주" position="top" fill={labelColor} fontSize={11} formatter={labelNumber} />
                </Bar>
                <Line dataKey="합계" stroke={COLOR_TOTAL} strokeWidth={2} dot={{ r: 3 }} connectNulls>
                  <LabelList dataKey="합계" position="top" fill={labelColor} fontSize={11} formatter={labelNumber} />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <ChartCard title="증착코일 외주비율" note={periodNote}>
          <RatioPie data={coilRatio} labelColor={labelColor} axisColor={axisColor} />
        </ChartCard>
      </div>
    </div>
  );
}

function RatioPie({
  data,
  labelColor,
  axisColor,
}: {
  data: { name: string; value: number; pct: number }[];
  labelColor: string;
  axisColor: string;
}) {
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-foreground/60">
        데이터가 없습니다.
      </p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={320}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={72}
          outerRadius={112}
          label={(props) => {
            const { x, y, cx, payload } = props as {
              x: number;
              y: number;
              cx: number;
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
                {labelPercent(payload.pct)}
              </text>
            );
          }}
        >
          {data.map((d) => (
            <Cell key={d.name} fill={d.name === KBM ? COLOR_KBM : COLOR_OUT} />
          ))}
        </Pie>
        <Tooltip {...TOOLTIP_PROPS} formatter={(v) => `${Math.round(Number(v)).toLocaleString()} kg`} />
        <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function ChartCard({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
      <p className="text-sm font-semibold">■ {title}</p>
      {note && <p className="text-xs text-foreground/50">{note}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

// 카드마다 색을 달리해 한눈에 구분되게 한다. Tailwind 는 클래스 이름을 정적으로
// 훑어 빌드하므로 색 이름을 조합해 만들면 안 되고, 이렇게 전체 문자열로 적어야 한다.
const KPI_TONES = {
  blue: "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950",
  pink: "border-pink-300 bg-pink-50 dark:border-pink-800 dark:bg-pink-950",
  amber: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950",
  emerald:
    "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950",
  violet:
    "border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950",
} as const;

const KPI_VALUE_TONES = {
  blue: "text-blue-700 dark:text-blue-300",
  pink: "text-pink-700 dark:text-pink-300",
  amber: "text-amber-700 dark:text-amber-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
  violet: "text-violet-700 dark:text-violet-300",
} as const;

function KpiCard({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  tone: keyof typeof KPI_TONES;
}) {
  return (
    <div
      className={`rounded-lg border p-4 text-center ${KPI_TONES[tone]}`}
    >
      <p className="text-xs text-foreground/60">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${KPI_VALUE_TONES[tone]}`}>
        {value}
        {unit && (
          <span className="ml-1 text-sm font-normal text-foreground/60">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}
