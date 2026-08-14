"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
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
import LastSyncBadge from "./LastSyncBadge";
import { periodDefaults } from "@/lib/period";
import { labelNumber, labelPercent } from "@/lib/format";

type ShipmentRecord = {
  ship_date: string;
  part_number: string;
  quantity: number;
  category: string;
  vendor: string;
};

const SELECT_COLUMNS = "ship_date, part_number, quantity, category, vendor";

// 실적이 아니라 아직 나가지 않은 물량. '예상'만 수주만 잡히고 아직 나가지
// 않은 분이라 수주잔량으로 센다. '세정출하'는 세정 협력사를 거쳐 나가는
// 정식 출하 경로라 ICT/KBM/PSNT와 같은 출하량으로 센다.
const BACKLOG_VENDORS = new Set(["예상"]);

const CATEGORY_DEV = "개발";
const CATEGORY_MASS = "양산";

const COLOR_DEV = "#38bdf8";
const COLOR_MASS = "#1e3a8a";
const COLOR_TOTAL = "#f97316";

const VENDOR_COLORS = [
  "#1e3a8a",
  "#38bdf8",
  "#f97316",
  "#7c3aed",
  "#ec4899",
  "#059669",
  "#a855f7",
  "#dc2626",
];
// 예상은 어느 대시보드에서나 같은 색이라야 눈이 안 헷갈린다.
const FIXED_VENDOR_COLORS: Record<string, string> = {
  예상: "#ec4899",
  세정출하: "#f97316",
};

const PART_CHART_LIMIT = 12;
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function isBacklog(r: ShipmentRecord) {
  return BACKLOG_VENDORS.has(r.vendor);
}

function sum(records: ShipmentRecord[]) {
  return records.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);
}

async function fetchAll(table: string): Promise<ShipmentRecord[]> {
  const supabase = createClient();
  const pageSize = 1000;

  const { count, error: countError } = await supabase
    .from(table)
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
        .from(table)
        .select(SELECT_COLUMNS)
        .order("ship_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return (data ?? []) as ShipmentRecord[];
    }),
  );

  return pages.flat();
}

export type ShipmentDashboardProps = {
  title: string;
  table: string;
  /** 업체 컬럼의 사람이 읽는 이름 -- "코팅업체" / "메시가공처" */
  vendorLabel: string;
  monthlyChartTitle: string;
  vendorChartTitle: string;
};

export default function ShipmentDashboard({
  title,
  table,
  vendorLabel,
  monthlyChartTitle,
  vendorChartTitle,
}: ShipmentDashboardProps) {
  const [records, setRecords] = useState<ShipmentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yearOverride, setYearOverride] = useState<string | null>(null);
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(),
  );
  const isDark = useIsDark();
  const axisColor = isDark ? "#d4d4d4" : "#404040";
  const labelColor = isDark ? "#f5f5f5" : "#171717";

  useEffect(() => {
    fetchAll(table)
      .then(setRecords)
      .catch((e) => setError(e.message ?? "데이터를 불러오지 못했습니다."));
  }, [table]);

  const years = useMemo(() => {
    if (!records) return [];
    return Array.from(
      new Set(records.map((r) => r.ship_date.slice(0, 4))),
    ).sort();
  }, [records]);

  // 실적이 있는 마지막 달로 연다. 예상/세정출하 행은 미래 날짜를 달고 있어
  // (수주 잔량이 연말까지 잡힌다) 전체 최대값을 쓰면 실적이 거의 없는 달이
  // 열린다. 그래서 최종출하일과 같은 기준 -- 실적 행 -- 으로 계산한다.
  const defaults = useMemo(
    () =>
      periodDefaults(
        (records ?? []).filter((r) => !isBacklog(r)).map((r) => r.ship_date),
      ),
    [records],
  );

  // 연도는 "전체" 없이 항상 한 해를 본다 -- 월별 차트의 x축이 1~12월이라
  // 여러 해를 겹쳐 놓으면 읽을 수 없기 때문. 실적이 하나도 없으면 그때만
  // 데이터에 있는 마지막 연도로 물러선다.
  const year =
    yearOverride ??
    (defaults.year !== "all" ? defaults.year : (years[years.length - 1] ?? null));
  const month = monthOverride ?? defaults.month;

  const categories = useMemo(() => {
    if (!records) return [];
    return Array.from(new Set(records.map((r) => r.category))).sort();
  }, [records]);

  // 구분 필터만 적용. 연도별 비교 차트가 전 기간을 봐야 해서 따로 둔다.
  const categoryFiltered = useMemo(() => {
    if (!records) return [];
    if (selectedCategories.size === 0) return records;
    return records.filter((r) => selectedCategories.has(r.category));
  }, [records, selectedCategories]);

  // 구분 + 연도. 월별 추이 차트들이 쓴다 (월 필터를 타면 한 달만 남아 추이가 사라진다).
  const yearFiltered = useMemo(
    () => categoryFiltered.filter((r) => r.ship_date.slice(0, 4) === year),
    [categoryFiltered, year],
  );

  // 구분 + 연도 + 월. KPI와 스냅샷 성격의 차트들이 쓴다.
  const filtered = useMemo(
    () =>
      yearFiltered.filter(
        (r) => month === "all" || r.ship_date.slice(5, 7) === month,
      ),
    [yearFiltered, month],
  );

  const monthlyTrend = useMemo(() => {
    return MONTHS.map((m) => {
      const key = String(m).padStart(2, "0");
      const recs = yearFiltered.filter((r) => r.ship_date.slice(5, 7) === key);
      const dev = sum(recs.filter((r) => r.category === CATEGORY_DEV));
      const mass = sum(recs.filter((r) => r.category === CATEGORY_MASS));
      return {
        month: m,
        [CATEGORY_DEV]: dev || null,
        [CATEGORY_MASS]: mass || null,
        total: dev + mass || null,
      };
    });
  }, [yearFiltered]);

  const vendorTrend = useMemo(() => {
    const vendors = Array.from(
      new Set(yearFiltered.map((r) => r.vendor)),
    ).sort((a, b) => {
      // 예상은 미래분이라 항상 스택 맨 위에 오도록 마지막에 둔다.
      if (a === "예상") return 1;
      if (b === "예상") return -1;
      return a.localeCompare(b);
    });

    const data = MONTHS.map((m) => {
      const key = String(m).padStart(2, "0");
      const recs = yearFiltered.filter((r) => r.ship_date.slice(5, 7) === key);
      const row: Record<string, number | null> = { month: m };
      for (const v of vendors) {
        row[v] = sum(recs.filter((r) => r.vendor === v)) || null;
      }
      row.total = sum(recs) || null;
      return row;
    });

    return { data, vendors };
  }, [yearFiltered]);

  const forecastSplit = useMemo(() => {
    const build = (label: string, recs: ShipmentRecord[]) => {
      const dev = sum(recs.filter((r) => r.category === CATEGORY_DEV));
      const mass = sum(recs.filter((r) => r.category === CATEGORY_MASS));
      return {
        name: label,
        [CATEGORY_DEV]: dev || null,
        [CATEGORY_MASS]: mass || null,
        total: dev + mass || null,
      };
    };
    return [
      build("출하량", filtered.filter((r) => !isBacklog(r))),
      build("수주잔량", filtered.filter(isBacklog)),
    ];
  }, [filtered]);

  const categorySplit = useMemo(() => {
    const total = sum(filtered);
    if (total === 0) return [];
    return [CATEGORY_DEV, CATEGORY_MASS]
      .map((c) => {
        const qty = sum(filtered.filter((r) => r.category === c));
        return {
          name: c,
          value: qty,
          pct: Math.round((qty / total) * 10000) / 100,
        };
      })
      .filter((d) => d.value > 0);
  }, [filtered]);

  const partRanking = useMemo(() => {
    const byPart = new Map<string, number>();
    for (const r of filtered) {
      byPart.set(
        r.part_number,
        (byPart.get(r.part_number) ?? 0) + (Number(r.quantity) || 0),
      );
    }
    return Array.from(byPart.entries())
      .map(([part, qty]) => ({ part, qty }))
      .filter((d) => d.qty > 0)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, PART_CHART_LIMIT);
  }, [filtered]);

  // 선택 연도와 그 전년을 비교한다. 업체가 실제로 실적을 낸 달만 분모로 잡아야
  // 중간에 거래가 없던 달이 평균을 끌어내리지 않는다.
  const vendorMonthlyAvg = useMemo(() => {
    if (!year) return { data: [], years: [] as string[] };
    const prev = String(Number(year) - 1);
    const compareYears = years.includes(prev) ? [prev, year] : [year];

    const vendors = Array.from(
      new Set(
        categoryFiltered
          .filter((r) => compareYears.includes(r.ship_date.slice(0, 4)))
          .map((r) => r.vendor),
      ),
    ).sort();

    const data = vendors
      .map((v) => {
        const row: Record<string, string | number | null> = { vendor: v };
        for (const y of compareYears) {
          const recs = categoryFiltered.filter(
            (r) => r.vendor === v && r.ship_date.slice(0, 4) === y,
          );
          const activeMonths = new Set(recs.map((r) => r.ship_date.slice(5, 7)))
            .size;
          row[y] = activeMonths === 0 ? null : Math.round(sum(recs) / activeMonths);
        }
        return row;
      })
      .filter((row) => compareYears.some((y) => row[y] !== null));

    return { data, years: compareYears };
  }, [categoryFiltered, year, years]);

  const kpi = useMemo(() => {
    const actual = filtered.filter((r) => !isBacklog(r));
    const backlog = filtered.filter(isBacklog);
    const lastShipped = actual
      .map((r) => r.ship_date)
      .sort()
      .at(-1);
    const lastOrder = backlog
      .map((r) => r.ship_date)
      .sort()
      .at(-1);
    return {
      shipped: sum(actual),
      backlog: sum(backlog),
      lastShipped: lastShipped ?? "-",
      lastOrder: lastOrder ?? "-",
    };
  }, [filtered]);

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (!records || year === null) {
    return <p className="text-sm text-foreground/60">불러오는 중...</p>;
  }

  const vendorColor = (v: string, i: number) =>
    FIXED_VENDOR_COLORS[v] ?? VENDOR_COLORS[i % VENDOR_COLORS.length];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">{title}</h1>
        <LastSyncBadge table={table} />
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div>
          <label className="mb-1 block text-xs text-foreground/60">연도</label>
          <select
            value={year}
            onChange={(e) => setYearOverride(e.target.value)}
            className="rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm text-black dark:border-white/10 dark:bg-neutral-800 dark:text-white"
          >
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
            {MONTHS.map((m) => (
              <option key={m} value={String(m).padStart(2, "0")}>
                {m}월
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-foreground/60">구분</span>
          <div className="flex flex-wrap gap-3 pt-1">
            {categories.map((c) => (
              <label key={c} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={selectedCategories.has(c)}
                  onChange={(e) => {
                    const next = new Set(selectedCategories);
                    if (e.target.checked) next.add(c);
                    else next.delete(c);
                    setSelectedCategories(next);
                  }}
                />
                {c}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="출하량"
          value={kpi.shipped.toLocaleString()}
          color="blue"
        />
        <KpiCard
          label="수주잔량"
          value={kpi.backlog.toLocaleString()}
          color="amber"
        />
        <KpiCard label="최종출하일" value={kpi.lastShipped} color="green" />
        <KpiCard label="수주입력일" value={kpi.lastOrder} color="indigo" />
      </div>

      {/* 좌 2 : 우 1 의 3행. 왼쪽은 12개월치를 그리는 차트라 폭이 더 필요하고,
          오른쪽은 항목이 두어 개뿐이라 좁아도 읽힌다. 같은 행의 카드 높이를
          맞추려고 차트 높이는 320 으로 통일했다. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ChartCard title={monthlyChartTitle} note={`${year}년 · 월 필터 무시`}>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={monthlyTrend} margin={{ top: 20, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="month" tick={{ fill: axisColor, fontSize: 13 }} />
                <YAxis
                  tick={{ fill: axisColor, fontSize: 13 }}
                  tickFormatter={labelNumber}
                />
                <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
                <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
                <Bar dataKey={CATEGORY_DEV} name="개발" fill={COLOR_DEV}>
                  <LabelList
                    dataKey={CATEGORY_DEV}
                    position="top"
                    fill={labelColor}
                    fontSize={12}
                    formatter={labelNumber}
                  />
                </Bar>
                <Bar dataKey={CATEGORY_MASS} name="양산" fill={COLOR_MASS}>
                  <LabelList
                    dataKey={CATEGORY_MASS}
                    position="top"
                    fill={labelColor}
                    fontSize={12}
                    formatter={labelNumber}
                  />
                </Bar>
                <Line
                  dataKey="total"
                  name="총출하량"
                  stroke={COLOR_TOTAL}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="total"
                    position="top"
                    fill={labelColor}
                    fontSize={13}
                    fontWeight={700}
                    formatter={labelNumber}
                  />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <ChartCard title="월별 예상 출하량" note="모든 필터 적용">
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={forecastSplit} margin={{ top: 20, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" tick={{ fill: axisColor, fontSize: 13 }} />
              <YAxis
                tick={{ fill: axisColor, fontSize: 13 }}
                tickFormatter={labelNumber}
              />
              <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
              <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
              <Bar dataKey={CATEGORY_DEV} name="개발" fill={COLOR_DEV}>
                <LabelList
                  dataKey={CATEGORY_DEV}
                  position="top"
                  fill={labelColor}
                  fontSize={13}
                  formatter={labelNumber}
                />
              </Bar>
              <Bar dataKey={CATEGORY_MASS} name="양산" fill={COLOR_MASS}>
                <LabelList
                  dataKey={CATEGORY_MASS}
                  position="top"
                  fill={labelColor}
                  fontSize={13}
                  formatter={labelNumber}
                />
              </Bar>
              <Bar dataKey="total" name="합계" fill={COLOR_TOTAL}>
                <LabelList
                  dataKey="total"
                  position="top"
                  fill={labelColor}
                  fontSize={13}
                  formatter={labelNumber}
                />
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="xl:col-span-2">
          <ChartCard title={vendorChartTitle} note={`${year}년 · 월 필터 무시`}>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={vendorTrend.data} margin={{ top: 20, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="month" tick={{ fill: axisColor, fontSize: 13 }} />
                <YAxis
                  tick={{ fill: axisColor, fontSize: 13 }}
                  tickFormatter={labelNumber}
                />
                <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
                <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
                {vendorTrend.vendors.map((v, i) => (
                  <Bar
                    key={v}
                    dataKey={v}
                    name={v}
                    stackId="vendor"
                    fill={vendorColor(v, i)}
                  >
                    <LabelList
                      dataKey={v}
                      position="center"
                      fill="#ffffff"
                      fontSize={12}
                      formatter={labelNumber}
                    />
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <ChartCard title="양산 vs. 개발" note="모든 필터 적용">
          {categorySplit.length === 0 ? (
            <p className="py-24 text-center text-sm text-foreground/60">
              데이터가 없습니다.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={categorySplit}
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
                        {`${name} ${labelPercent(payload.pct)}`}
                      </text>
                    );
                  }}
                >
                  {categorySplit.map((d) => (
                    <Cell
                      key={d.name}
                      fill={d.name === CATEGORY_DEV ? COLOR_DEV : COLOR_MASS}
                    />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <div className="xl:col-span-2">
          <ChartCard title="품번별 출하량" note="모든 필터 적용 · 상위 12">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={partRanking}
                layout="vertical"
                margin={{ right: 48 }}
              >
                <XAxis
                  type="number"
                  tick={{ fill: axisColor, fontSize: 13 }}
                  tickFormatter={labelNumber}
                />
                <YAxis
                  type="category"
                  dataKey="part"
                  width={125}
                  tick={{ fill: axisColor, fontSize: 12 }}
                />
                <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
                <Bar dataKey="qty" name="출하량" fill={COLOR_DEV}>
                  <LabelList
                    dataKey="qty"
                    position="right"
                    fill={labelColor}
                    fontSize={12}
                    formatter={labelNumber}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <ChartCard
          title="월평균 수량 비교"
          note={`${vendorMonthlyAvg.years.join(" vs ")} · 실적이 있는 달만 평균`}
        >
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={vendorMonthlyAvg.data} margin={{ top: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="vendor" tick={{ fill: axisColor, fontSize: 12 }} />
              <YAxis
                tick={{ fill: axisColor, fontSize: 13 }}
                tickFormatter={labelNumber}
              />
              <Tooltip {...TOOLTIP_PROPS} formatter={labelNumber} />
              <Legend wrapperStyle={{ color: axisColor, fontSize: 13 }} />
              {vendorMonthlyAvg.years.map((y, i) => (
                <Bar
                  key={y}
                  dataKey={y}
                  name={y}
                  fill={i === 0 ? COLOR_DEV : COLOR_MASS}
                >
                  <LabelList
                    dataKey={y}
                    position="top"
                    fill={labelColor}
                    fontSize={12}
                    formatter={labelNumber}
                  />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <p className="text-xs text-foreground/50">
        수주잔량은 {vendorLabel}가{" "}
        {Array.from(BACKLOG_VENDORS)
          .filter((v) => vendorTrend.vendors.includes(v))
          .map((v) => `"${v}"`)
          .join(" 또는 ")}
        인 건이고, 출하량은 그 외 전부입니다.
      </p>
    </div>
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
    // h-full: 그리드 한 행 안에서 설명 줄 수가 달라도 카드 테두리 높이를 맞춘다.
    <div className="h-full rounded-lg border border-black/10 p-4 dark:border-white/10">
      <p className="text-sm font-semibold">{title}</p>
      {note && <p className="text-xs text-foreground/50">{note}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

const KPI_COLOR_CLASSES = {
  blue: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950",
  amber: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
  green: "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950",
  indigo:
    "border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950",
} as const;

const KPI_VALUE_COLOR_CLASSES = {
  blue: "text-blue-700 dark:text-blue-300",
  amber: "text-amber-700 dark:text-amber-300",
  green: "text-green-700 dark:text-green-300",
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
