import * as XLSX from "xlsx";

export type ElectronBeamRecordRow = {
  work_date: string;
  process: string;
  part_number: string;
  part_code: string | null;
  spec: string | null;
  item_name: string | null;
  category_major: string | null;
  category_mid: string | null;
  category_sub: string | null;
  qty_total: number;
  qty_defect: number;
  qty_good: number;
};

export type ElectronBeamDefectRow = {
  work_date: string;
  process: string;
  part_number: string;
  part_code: string | null;
  item_name: string | null;
  spec: string | null;
  defect_code: string | null;
  defect_type: string;
  cause_code: string | null;
  cause: string | null;
  qty_total: number;
  qty_defect: number;
};

const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);

// Same UTC-based conversion as the other importers -- xlsx's cellDates option
// shifts dates by a day on non-UTC servers (this one is Asia/Seoul).
function toDateString(v: unknown): string | null {
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

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = toStr(v);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// 품목 코드는 "GWELE0031" 처럼 접두사(GWELE) + 4자리 숫자 꼴이다. 차트는 그
// 4자리만 쓰므로("0031", "0041"...) 앞의 글자를 떼고 숫자 4자리만 남긴다.
function partCode(partNumber: string | null): string | null {
  if (!partNumber) return null;
  return partNumber.replace(/^[A-Za-z]+/, "").match(/^(\d{4})/)?.[1] ?? null;
}

function readSheet(
  workbook: XLSX.WorkBook,
  name: string,
  range: number,
): unknown[][] {
  const sheet = workbook.Sheets[name];
  if (!sheet) {
    throw new Error(`시트 "${name}"을 찾을 수 없습니다.`);
  }
  return XLSX.utils.sheet_to_json(sheet, { header: 1, range, defval: null });
}

export const ELECTRON_BEAM_ERP_SHEET = "ERPDATA";
export const ELECTRON_BEAM_DEFECT_SHEET = "불량ERP";

// ERPDATA 는 나주공장 전체 공정 실적이 한 시트에 섞여 있는 원본이라, 전자빔
// 품질 대시보드가 실제로 추적하는 5개 공정만 남긴다 (전자빔열처리, 전자빔
// 다리절단은 이 대시보드에서 추적하지 않는 공정이라 일부러 뺀다).
const ELECTRON_BEAM_PROCESSES = new Set([
  "전자빔검사",
  "전자빔세척",
  "전자빔절곡",
  "전자빔코일링",
  "전자빔프레스",
]);

// 작업일 | 작업장 | 공정 | 품목 | 규격 | 품목명 | 단위 | 실적수량 | 불량수량 |
// 양품수량 | 비고1 | 단중(g) | 비고2 | 작업시간(H) | 작업자 | 담당자 | 대분류 |
// 중분류 | 소분류 | 작업지시번호 | 작업실적번호
//
// 1행은 "업데이트 : ..." 안내 문구, 2행이 헤더라 데이터는 3행부터(range: 2).
export function parseElectronBeamRecords(
  buffer: ArrayBuffer,
): ElectronBeamRecordRow[] {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    dense: true,
  });
  const rows = readSheet(workbook, ELECTRON_BEAM_ERP_SHEET, 2);

  const result: ElectronBeamRecordRow[] = [];
  for (const row of rows) {
    const process = toStr(row[2]);
    if (!process || !ELECTRON_BEAM_PROCESSES.has(process)) continue;
    const workDate = toDateString(row[0]);
    if (!workDate) continue;
    const partNumber = toStr(row[3]);
    if (!partNumber) continue;

    result.push({
      work_date: workDate,
      process,
      part_number: partNumber,
      part_code: partCode(partNumber),
      spec: toStr(row[4]),
      item_name: toStr(row[5]),
      qty_total: toNum(row[7]) ?? 0,
      qty_defect: toNum(row[8]) ?? 0,
      qty_good: toNum(row[9]) ?? 0,
      category_major: toStr(row[16]),
      category_mid: toStr(row[17]),
      category_sub: toStr(row[18]),
    });
  }

  return result;
}

// 작업실적번호 | 작업지시번호 | 실적일 | 작업장명 | 공정명 | 품목 | 품목명 |
// 규격 | 단위 | 불량코드 | 불량내역 | 불량원인코드 | 불량원인 | 작업수량 |
// 불량수량 | 불량율(%) | 불량율(ppm) | 형상 추출 | 품번
export function parseElectronBeamDefects(
  buffer: ArrayBuffer,
): ElectronBeamDefectRow[] {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    dense: true,
  });
  const rows = readSheet(workbook, ELECTRON_BEAM_DEFECT_SHEET, 2);

  const result: ElectronBeamDefectRow[] = [];
  for (const row of rows) {
    const workDate = toDateString(row[2]);
    if (!workDate) continue;
    const partNumber = toStr(row[5]);
    if (!partNumber) continue;
    const defectType = toStr(row[10]);
    if (!defectType) continue;

    result.push({
      work_date: workDate,
      process: toStr(row[4]) ?? "",
      part_number: partNumber,
      part_code: partCode(partNumber),
      item_name: toStr(row[6]),
      spec: toStr(row[7]),
      defect_code: toStr(row[9]),
      defect_type: defectType,
      cause_code: toStr(row[11]),
      cause: toStr(row[12]),
      qty_total: toNum(row[13]) ?? 0,
      qty_defect: toNum(row[14]) ?? 0,
    });
  }

  return result;
}
