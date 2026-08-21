import * as XLSX from "xlsx";

export type CoatingRow = {
  coating_lot: string;
  coating_date: string;
  part_number: string;
  serial_no: string | null;
  spec: string | null;
  coating_round: string;
  round_no: number | null;
  position: string | null;
  direction: string | null;
  note: string | null;
  inspection_date: string | null;
  front_result: string | null;
  back_result: string | null;
  recoat: string | null;
  shape_fix: string | null;
  inspection_note: string | null;
  final_verdict: string;
  note2: string | null;
  work_order_no: string | null;
  source_sheet: string;
};

const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);

function toDateString(v: unknown): string | null {
  // Excel date cells come through as plain numbers (day count since the
  // 1899-12-30 epoch) when cellDates isn't enabled. Converting that number
  // ourselves with UTC math avoids xlsx's cellDates conversion, which is
  // sensitive to the server's local timezone and can shift the date by a
  // day on non-UTC servers (this one runs in Asia/Seoul, UTC+9).
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(EXCEL_EPOCH_UTC_MS + Math.round(v) * 86400000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parseRoundNo(v: unknown): number | null {
  const s = toStr(v);
  if (!s) return null;
  const num = s.replace("차", "").trim();
  return /^\d+$/.test(num) ? Number(num) : null;
}

// Mirrors the "코팅현황" sheet layout: 3 header rows, then one row per
// coating/inspection event. Every row is kept as-is (no deduplication) --
// rows that look like duplicates (same LOT + round) turned out to be
// genuine separate records (re-tests / split F-R handling).
//
// 2026-08-21에 "Serial No" 바로 다음에 "규격" 열이 새로 추가돼서, 그 뒤
// 모든 열의 인덱스가 하나씩 밀렸다(코팅LOT, 코팅일자, 품번, Serial No, 규격,
// 코팅차수, 위치, 방향, ...).
export const COATING_SHEET = "코팅현황";

export function parseCoatingExcel(buffer: ArrayBuffer): CoatingRow[] {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheet = workbook.Sheets[COATING_SHEET];
  if (!sheet) {
    throw new Error(`시트 "${COATING_SHEET}"을 찾을 수 없습니다.`);
  }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    range: 3,
    defval: null,
  });

  const result: CoatingRow[] = [];
  for (const row of rows) {
    if (row[0] === null || row[0] === undefined || row[0] === "") continue;
    const coatingDate = toDateString(row[1]);
    if (!coatingDate) continue;

    result.push({
      coating_lot: String(row[0]).trim(),
      coating_date: coatingDate,
      part_number: toStr(row[2]) ?? "",
      serial_no: toStr(row[3]),
      spec: toStr(row[4]),
      coating_round: toStr(row[5]) ?? "",
      round_no: parseRoundNo(row[5]),
      position: toStr(row[6]),
      direction: toStr(row[7]),
      note: toStr(row[8]),
      inspection_date: toDateString(row[9]),
      front_result: toStr(row[10]),
      back_result: toStr(row[11]),
      recoat: toStr(row[12]),
      shape_fix: toStr(row[13]),
      inspection_note: toStr(row[14]),
      final_verdict: toStr(row[15]) ?? "",
      note2: toStr(row[16]),
      work_order_no: toStr(row[17]),
      source_sheet: "current",
    });
  }

  return result;
}
