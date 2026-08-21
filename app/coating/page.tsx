"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  PieChart,
  Pie,
  Cell,
  LabelList,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { TOOLTIP_PROPS } from "@/lib/chart";
import { useIsDark } from "@/lib/use-is-dark";
import { periodDefaults } from "@/lib/period";
import { labelNumber, labelPercent } from "@/lib/format";
import LastSyncBadge from "@/components/dashboard/LastSyncBadge";

type CoatingRecord = {
  id: number;
  coating_lot: string;
  coating_date: string;
  part_number: string;
  serial_no: string | null;
  spec: string | null;
  coating_round: string;
  round_no: number | null;
  position: string | null;
  direction: string | null;
  inspection_date: string | null;
  final_verdict: string;
};

type HeatTreatment = "normal" | "high";

// 규격에 "1400"이 들어 있으면 고온열처리, 그 외는 일반열처리.
function heatTreatmentOf(spec: string | null): HeatTreatment {
  return spec?.includes("1400") ? "high" : "normal";
}

const PIE_COLORS = ["#2563eb", "#93c5fd"];

function isPass(v: string) {
  return v === "1.OK";
}
function isFail(v: string) {
  return v === "2.NG";
}
function isScrap(v: string) {
  return v === "4.폐기";
}
function isPending(v: string) {
  return v === "3.검사대기";
}

function passRate(records: CoatingRecord[]) {
  const pass = records.filter((r) => isPass(r.final_verdict)).length;
  const fail = records.filter((r) => isFail(r.final_verdict)).length;
  const denom = pass + fail;
  return denom === 0 ? null : pass / denom;
}

function pct(v: number | null) {
  return v === null ? "-" : `${Math.round(v * 100)}%`;
}

function cellColor(v: number | null) {
  if (v === null) return "";
  if (v < 0.7) return "bg-red-500 text-white";
  if (v < 0.85) return "bg-blue-100 text-black";
  if (v < 0.95) return "bg-blue-300 text-black";
  return "bg-blue-500 text-white";
}

async function fetchAllCoatingRecords(): Promise<CoatingRecord[]> {
  const supabase = createClient();
  const pageSize = 1000;
  let from = 0;
  let all: CoatingRecord[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("coating_records")
      .select(
        "id, coating_lot, coating_date, part_number, serial_no, spec, coating_round, round_no, position, direction, inspection_date, final_verdict",
      )
      .order("coating_date", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    all = all.concat(data as CoatingRecord[]);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export default function CoatingPage() {
  const [records, setRecords] = useState<CoatingRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 데이터가 있는 마지막 달로 열되, 사용자가 한 번이라도 고르면 그 선택을 따른다
  // ("전체"도 유효한 선택이므로 null 만 "아직 안 고름"을 뜻한다).
  const [yearOverride, setYearOverride] = useState<string | null>(null);
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const [selectedParts, setSelectedParts] = useState<Set<string>>(new Set());
  const [partsOpen, setPartsOpen] = useState(false);
  const [heatFilter, setHeatFilter] = useState<"all" | HeatTreatment>("all");
  const isDark = useIsDark();
  const axisColor = isDark ? "#d4d4d4" : "#404040";
  const labelColor = isDark ? "#f5f5f5" : "#171717";

  useEffect(() => {
    fetchAllCoatingRecords()
      .then(setRecords)
      .catch((e) => setError(e.message ?? "데이터를 불러오지 못했습니다."));
  }, []);

  const partNumbers = useMemo(() => {
    if (!records) return [];
    return Array.from(new Set(records.map((r) => r.part_number))).sort();
  }, [records]);

  const years = useMemo(() => {
    if (!records) return [];
    return Array.from(
      new Set(records.map((r) => r.coating_date.slice(0, 4))),
    ).sort();
  }, [records]);

  const defaults = useMemo(
    () => periodDefaults(records?.map((r) => r.coating_date) ?? []),
    [records],
  );
  const year = yearOverride ?? defaults.year;
  const month = monthOverride ?? defaults.month;

  const partFiltered = useMemo(() => {
    if (!records) return [];
    if (selectedParts.size === 0) return records;
    return records.filter((r) => selectedParts.has(r.part_number));
  }, [records, selectedParts]);

  // 열처리 필터는 월별 생산수량 차트만 빼고 나머지 전부에 적용된다(그 차트는
  // 일반/고온을 항상 나란히 보여줘야 해서 partFiltered를 그대로 쓴다).
  const heatFiltered = useMemo(() => {
    if (heatFilter === "all") return partFiltered;
    return partFiltered.filter((r) => heatTreatmentOf(r.spec) === heatFilter);
  }, [partFiltered, heatFilter]);

  const filtered = useMemo(() => {
    return heatFiltered.filter((r) => {
      if (year !== "all" && r.coating_date.slice(0, 4) !== year) return false;
      if (month !== "all" && r.coating_date.slice(5, 7) !== month)
        return false;
      return true;
    });
  }, [heatFiltered, year, month]);

  const kpi = useMemo(() => {
    const total = filtered.length;
    const pass = filtered.filter((r) => isPass(r.final_verdict)).length;
    const fail = filtered.filter((r) => isFail(r.final_verdict)).length;
    const scrap = filtered.filter((r) => isScrap(r.final_verdict)).length;
    return { total, pass, fail, scrap };
  }, [filtered]);

  const queues = useMemo(() => {
    const countAt = (round: number, pred: (v: string) => boolean) =>
      heatFiltered.filter((r) => r.round_no === round && pred(r.final_verdict))
        .length;

    const inspectionRounds = [1, 2, 3, 4, 5];
    const coatingRounds = [2, 3, 4, 5];

    const inspectionWaiting: Record<number, number> = {};
    for (const round of inspectionRounds) {
      inspectionWaiting[round] = countAt(round, isPending);
    }

    const coatingWaiting: Record<number, number> = {};
    for (const round of coatingRounds) {
      const prevFail = countAt(round - 1, isFail);
      const curOk = countAt(round, isPass);
      const curFail = countAt(round, isFail);
      const curScrap = countAt(round, isScrap);
      const curPending = countAt(round, isPending);
      coatingWaiting[round] =
        prevFail - curOk - curFail - curScrap - curPending;
    }

    return { inspectionRounds, coatingRounds, inspectionWaiting, coatingWaiting };
  }, [heatFiltered]);

  const monthlyTrend = useMemo(() => {
    const byMonth = new Map<string, CoatingRecord[]>();
    for (const r of partFiltered) {
      const key = r.coating_date.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(r);
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, recs]) => {
        const total = recs.length;
        const scrap = recs.filter((r) => isScrap(r.final_verdict)).length;
        const normalRecs = recs.filter((r) => heatTreatmentOf(r.spec) === "normal");
        const highRecs = recs.filter((r) => heatTreatmentOf(r.spec) === "high");
        const normalRate = passRate(normalRecs);
        const highRate = passRate(highRecs);
        return {
          // "26-03" 처럼 연도를 붙인다. 월만 쓰면 여러 해가 이어질 때
          // 어느 해의 3월인지 구분이 안 된다.
          month: key.slice(2),
          생산수량_일반: normalRecs.length,
          생산수량_고온열처리: highRecs.length,
          생산수량_합계: normalRecs.length + highRecs.length,
          합격률_일반: normalRate === null ? null : Math.round(normalRate * 100),
          합격률_고온열처리: highRate === null ? null : Math.round(highRate * 100),
          scrapRatePct: total === 0 ? 0 : Math.round((scrap / total) * 100),
        };
      });
  }, [partFiltered]);

  // 막대 눈금을 데이터에 딱 맞추면 가장 높은 달의 막대가 천장까지 닿아
  // 합격률 선과 붙어버린다. 최대값 위로 30% 여유를 두되 100 단위로 올림하고,
  // 생산량이 적은 달만 골라 봐도 그래프가 뭉개지지 않게 400 을 하한으로 둔다.
  const qtyAxisMax = useMemo(() => {
    const max = monthlyTrend.reduce(
      (m, d) => Math.max(m, d.생산수량_일반 + d.생산수량_고온열처리),
      0,
    );
    return Math.max(400, Math.ceil((max * 1.3) / 100) * 100);
  }, [monthlyTrend]);

  const roundRate = useMemo(() => {
    return [1, 2, 3].map((round) => {
      const recs = filtered.filter((r) => r.round_no === round);
      return {
        round: `${round}차`,
        ratePct: (() => {
          const r = passRate(recs);
          return r === null ? 0 : Math.round(r * 100);
        })(),
      };
    });
  }, [filtered]);

  const positionRate = useMemo(() => {
    return ["UP", "DOWN"]
      .map((pos) => {
        const recs = filtered.filter((r) => r.position === pos);
        const r = passRate(recs);
        return { name: pos, value: r === null ? 0 : Math.round(r * 1000) / 10 };
      })
      .filter((d) => d.value > 0);
  }, [filtered]);

  const partRate = useMemo(() => {
    const parts = Array.from(new Set(filtered.map((r) => r.part_number)));
    return parts
      .map((p) => {
        const recs = filtered.filter((r) => r.part_number === p);
        const r = passRate(recs);
        return { part: p, ratePct: r === null ? null : Math.round(r * 100) };
      })
      .filter((d) => d.ratePct !== null)
      .sort((a, b) => (b.ratePct ?? 0) - (a.ratePct ?? 0))
      .slice(0, 10);
  }, [filtered]);

  const dailyTable = useMemo(() => {
    const byDate = new Map<string, CoatingRecord[]>();
    for (const r of filtered) {
      if (!byDate.has(r.coating_date)) byDate.set(r.coating_date, []);
      byDate.get(r.coating_date)!.push(r);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, recs]) => {
        const rounds: Record<number, number | null> = {};
        for (const round of [1, 2, 3, 4]) {
          rounds[round] = passRate(recs.filter((r) => r.round_no === round));
        }
        return { date, rounds, total: passRate(recs) };
      });
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
        <h1 className="text-lg font-semibold">코팅현황</h1>
        <LastSyncBadge table="coating_records" />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-xs text-foreground/60">
            연도
          </label>
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
        <div className="relative ml-16">
          <span className="mb-1 block text-xs text-foreground/60">품번</span>
          <button
            type="button"
            onClick={() => setPartsOpen((v) => !v)}
            className="rounded-md border border-black/10 bg-white px-2 py-1.5 text-left text-sm text-black dark:border-white/10 dark:bg-neutral-800 dark:text-white"
          >
            {selectedParts.size === 0
              ? "전체"
              : `${selectedParts.size}개 선택`}
            <span className="ml-2 text-foreground/40">▾</span>
          </button>

          {partsOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setPartsOpen(false)}
                aria-hidden
              />
              <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded-md border border-black/10 bg-white p-2 shadow-lg dark:border-white/10 dark:bg-neutral-800">
                <label className="flex items-center gap-2 border-b border-black/10 pb-2 text-sm dark:border-white/10">
                  <input
                    type="checkbox"
                    checked={selectedParts.size === 0}
                    onChange={() => setSelectedParts(new Set())}
                  />
                  전체
                </label>
                <div className="flex flex-col gap-1 pt-2">
                  {partNumbers.map((p) => (
                    <label
                      key={p}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedParts.has(p)}
                        onChange={(e) => {
                          const next = new Set(selectedParts);
                          if (e.target.checked) next.add(p);
                          else next.delete(p);
                          setSelectedParts(next);
                        }}
                      />
                      {p}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="ml-16">
          <label className="mb-1 block text-xs text-foreground/60">
            열처리
          </label>
          <select
            value={heatFilter}
            onChange={(e) =>
              setHeatFilter(e.target.value as "all" | HeatTreatment)
            }
            className="rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm text-black dark:border-white/10 dark:bg-neutral-800 dark:text-white"
          >
            <option value="all">전체</option>
            <option value="normal">일반열처리</option>
            <option value="high">고온열처리</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="투입량" value={kpi.total} color="blue" />
        <KpiCard label="합격" value={kpi.pass} color="green" />
        <KpiCard label="불합격" value={kpi.fail} color="red" />
        <KpiCard label="폐기" value={kpi.scrap} color="amber" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div
          className={`rounded-lg border p-4 ${KPI_COLOR_CLASSES.indigo}`}
        >
          <p className="mb-2 text-sm font-semibold">검사 대기 (차수별)</p>
          <div className="grid grid-cols-5 gap-2 text-center">
            {queues.inspectionRounds.map((r) => (
              <div key={r}>
                <p className="text-xs text-foreground/60">{r}차</p>
                <p className="text-lg font-semibold">
                  {queues.inspectionWaiting[r] || "-"}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className={`rounded-lg border p-4 ${KPI_COLOR_CLASSES.teal}`}>
          <p className="mb-2 text-sm font-semibold">코팅 대기 (차수별)</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            {queues.coatingRounds.map((r) => (
              <div key={r}>
                <p className="text-xs text-foreground/60">{r}차</p>
                <p className="text-lg font-semibold">
                  {queues.coatingWaiting[r] || "-"}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
        <p className="mb-4 text-sm font-semibold">
          월별 생산수량, 합격률 및 폐기율 (일반 vs 고온열처리)
        </p>
        <p className="-mt-3 mb-6 text-xs text-foreground/50">
          열처리 필터와 무관하게 항상 일반/고온열처리를 함께 보여준다
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={monthlyTrend} margin={{ top: 30, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="month" tick={{ fill: axisColor, fontSize: 14 }} />
            <YAxis
              yAxisId="left"
              domain={[0, qtyAxisMax]}
              tick={{ fill: axisColor, fontSize: 14 }}
              tickFormatter={labelNumber}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              tick={{ fill: axisColor, fontSize: 14 }}
            />
            <Tooltip {...TOOLTIP_PROPS} />
            <Legend wrapperStyle={{ color: axisColor, fontSize: 14 }} itemSorter={null} />
            <Bar
              yAxisId="left"
              dataKey="생산수량_일반"
              name="생산수량_일반"
              stackId="qty"
              fill="#93c5fd"
            >
              <LabelList dataKey="생산수량_일반" position="inside" fill="#171717" fontSize={12} formatter={labelNumber} />
            </Bar>
            <Bar
              yAxisId="left"
              dataKey="생산수량_고온열처리"
              name="생산수량_고온열처리"
              stackId="qty"
              fill="#f4a8a8"
            >
              <LabelList dataKey="생산수량_고온열처리" position="inside" fill="#171717" fontSize={12} formatter={labelNumber} />
            </Bar>
            {/* 쌓인 막대 맨 위에 합계를 보여주기 위한 투명 선. 막대로는 값이
                0인 지점에서 라벨 자체가 안 그려져서, 대신 "합계" 값 그대로를
                찍는 선(보이지는 않게)에 라벨만 얹는다. */}
            <Line
              yAxisId="left"
              dataKey="생산수량_합계"
              name="생산수량_합계"
              stroke="none"
              dot={false}
              legendType="none"
              isAnimationActive={false}
            >
              <LabelList
                dataKey="생산수량_합계"
                position="top"
                fill={labelColor}
                fontSize={13}
                fontWeight={700}
                formatter={labelNumber}
              />
            </Line>
            <Line
              yAxisId="right"
              dataKey="합격률_일반"
              name="합격률_일반"
              stroke="#1e3a8a"
              strokeWidth={2}
              dot={{ r: 3 }}
            >
              <LabelList
                dataKey="합격률_일반"
                position="top"
                fill={labelColor}
                fontSize={13}
                formatter={labelPercent}
              />
            </Line>
            <Line
              yAxisId="right"
              dataKey="합격률_고온열처리"
              name="합격률_고온열처리"
              stroke="#f97316"
              strokeWidth={2}
              dot={{ r: 3 }}
            >
              <LabelList
                dataKey="합격률_고온열처리"
                position="top"
                fill={labelColor}
                fontSize={13}
                formatter={labelPercent}
              />
            </Line>
            <Line
              yAxisId="right"
              dataKey="scrapRatePct"
              name="폐기율(%)"
              stroke="#6b7280"
              strokeDasharray="4 3"
              strokeWidth={2}
              dot={false}
            >
              {/* 아래로 붙이면 0 근처에서 x축 글자와 겹친다. 위로 올려도
                  합격률선들은 90% 부근이라 서로 부딪히지 않는다. */}
              <LabelList
                dataKey="scrapRatePct"
                position="top"
                fill={labelColor}
                fontSize={13}
                formatter={labelPercent}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
          <p className="mb-4 text-sm font-semibold">차수별 합격률</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={roundRate}>
              <XAxis dataKey="round" tick={{ fill: axisColor, fontSize: 14 }} />
              <YAxis domain={[0, 100]} tick={{ fill: axisColor, fontSize: 14 }} />
              <Tooltip {...TOOLTIP_PROPS} />
              <Bar dataKey="ratePct" name="합격률(%)" fill="#2563eb">
                <LabelList
                  dataKey="ratePct"
                  position="top"
                  fill={labelColor}
                  fontSize={14}
                  formatter={labelPercent}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
          <p className="mb-4 text-sm font-semibold">위치별 합격률</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={positionRate}
                dataKey="value"
                nameKey="name"
                outerRadius={80}
                label={(props) => {
                  const { x, y, cx, name, value } = props as {
                    x: number;
                    y: number;
                    cx: number;
                    name: string;
                    value: number;
                  };
                  return (
                    <text
                      x={x}
                      y={y}
                      fill={labelColor}
                      fontSize={14}
                      textAnchor={x > cx ? "start" : "end"}
                      dominantBaseline="central"
                    >
                      {`${name} ${value}%`}
                    </text>
                  );
                }}
              >
                {positionRate.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip {...TOOLTIP_PROPS} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
          <p className="mb-4 text-sm font-semibold">품번별 합격률</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={partRate} layout="vertical">
              <XAxis
                type="number"
                domain={[0, 100]}
                tick={{ fill: axisColor, fontSize: 14 }}
              />
              <YAxis
                type="category"
                dataKey="part"
                width={115}
                tick={{ fill: axisColor, fontSize: 13 }}
              />
              <Tooltip {...TOOLTIP_PROPS} />
              <Bar dataKey="ratePct" name="합격률(%)" fill="#2563eb">
                <LabelList
                  dataKey="ratePct"
                  position="right"
                  fill={labelColor}
                  fontSize={13}
                  formatter={labelPercent}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-black/10 dark:border-white/10">
        <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
          <p className="text-sm font-semibold">일자별 차수별 합격률</p>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b border-black/10 text-left dark:border-white/10">
                <th className="px-3 py-2 font-medium">코팅일자</th>
                <th className="px-3 py-2 font-medium">1차</th>
                <th className="px-3 py-2 font-medium">2차</th>
                <th className="px-3 py-2 font-medium">3차</th>
                <th className="px-3 py-2 font-medium">4차</th>
                <th className="px-3 py-2 font-medium">합계</th>
              </tr>
            </thead>
            <tbody>
              {dailyTable.map((row) => (
                <tr
                  key={row.date}
                  className="border-b border-black/5 dark:border-white/5"
                >
                  <td className="px-3 py-1.5">{row.date}</td>
                  {[1, 2, 3, 4].map((r) => (
                    <td
                      key={r}
                      className={`px-3 py-1.5 text-center ${cellColor(row.rounds[r])}`}
                    >
                      {pct(row.rounds[r])}
                    </td>
                  ))}
                  <td
                    className={`px-3 py-1.5 text-center font-medium ${cellColor(row.total)}`}
                  >
                    {pct(row.total)}
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

const KPI_COLOR_CLASSES = {
  blue: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950",
  green:
    "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950",
  red: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950",
  amber:
    "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
  indigo:
    "border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950",
  teal: "border-teal-200 bg-teal-50 dark:border-teal-900 dark:bg-teal-950",
} as const;

const KPI_VALUE_COLOR_CLASSES = {
  blue: "text-blue-700 dark:text-blue-300",
  green: "text-green-700 dark:text-green-300",
  red: "text-red-700 dark:text-red-300",
  amber: "text-amber-700 dark:text-amber-300",
  indigo: "text-indigo-700 dark:text-indigo-300",
  teal: "text-teal-700 dark:text-teal-300",
} as const;

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
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
