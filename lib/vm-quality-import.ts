import * as XLSX from "xlsx";

export type VmQualityRecordRow = {
  work_date: string;
  process: string;
  part_number: string;
  shape: string;
  spec: string | null;
  item_name: string | null;
  category_major: string | null;
  category_mid: string | null;
  category_sub: string | null;
  qty_total: number;
  qty_defect: number;
  qty_good: number;
};

export type VmQualityDefectRow = {
  work_date: string;
  process: string;
  part_number: string;
  shape: string;
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

// 참고 화면의 "형상별" 차트는 규격(예: "Wave 0.85X3CX120L 10H")의 첫 영어
// 단어로 모양을 나눈다. 이 사전에 없는 모양은 "기타"로 묶인다 -- 화면에서
// 본 5개 말고 다른 모양이 나오면 이 목록을 늘려야 한다.
const SHAPE_NAMES: Record<string, string> = {
  wave: "파도",
  glass: "안경",
  mountain: "산",
  snail: "달팽이",
  coil: "코일",
};

function shapeOf(spec: string | null): string {
  // 앞에 숫자가 붙는 규격("1Mountain 0.8X3CX...")이 있어서 맨 앞이 아니라
  // 첫 영어 단어를 찾는다. "권선 0.8X3CX..." 처럼 영어 형상 단어가 전혀 없는
  // 규격도 있어서, 그런 건 그대로 "기타"로 남는다.
  const first = spec?.match(/[A-Za-z]+/)?.[0]?.toLowerCase();
  return (first && SHAPE_NAMES[first]) || "기타";
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

export const VM_QUALITY_ERP_SHEET = "ERPDATA";
export const VM_QUALITY_DEFECT_SHEET = "불량ERP";

// ERPDATA 는 나주공장 전체 공정 실적이 한 시트에 섞여 있는 원본이라, VM코일
// 품질 대시보드가 실제로 추적하는 6개 공정만 남긴다.
export const VM_QUALITY_PROCESSES = new Set([
  "V/M 검사",
  "권선",
  "절단",
  "코일링",
  "프레스",
  "토션기",
]);

// 일부 공정에는 증착재(VM코일이 아닌 별개 품목) 실적이 구분 없이 섞여
// 들어온다. 품목 코드로 걸러낸다 -- "IBF"/"ELE" 가 들어간 품목은 증착재라
// VM코일 품질 집계에서 뺀다.
function isDepositionMaterial(partNumber: string): boolean {
  return partNumber.includes("IBF") || partNumber.includes("ELE");
}

// 작업일 | 작업장 | 공정 | 품목 | 규격 | 품목명 | 단위 | 실적수량 | 불량수량 |
// 양품수량 | 비고1 | 단중(g) | 비고2 | 작업시간(H) | 작업자 | 담당자 | 대분류 |
// 중분류 | 소분류 | 작업지시번호 | 작업실적번호
export function parseVmQualityRecords(
  buffer: ArrayBuffer,
): VmQualityRecordRow[] {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    dense: true,
  });
  const rows = readSheet(workbook, VM_QUALITY_ERP_SHEET, 2);

  const result: VmQualityRecordRow[] = [];
  for (const row of rows) {
    const process = toStr(row[2]);
    if (!process || !VM_QUALITY_PROCESSES.has(process)) continue;
    const workDate = toDateString(row[0]);
    if (!workDate) continue;
    const partNumber = toStr(row[3]);
    if (!partNumber || isDepositionMaterial(partNumber)) continue;
    const spec = toStr(row[4]);

    result.push({
      work_date: workDate,
      process,
      part_number: partNumber,
      shape: shapeOf(spec),
      spec,
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
// 불량수량 | 불량율(%) | 불량율(ppm) | 형상 추출 | 형상
export function parseVmQualityDefects(
  buffer: ArrayBuffer,
): VmQualityDefectRow[] {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    dense: true,
  });
  const rows = readSheet(workbook, VM_QUALITY_DEFECT_SHEET, 2);

  const result: VmQualityDefectRow[] = [];
  for (const row of rows) {
    const workDate = toDateString(row[2]);
    if (!workDate) continue;
    const partNumber = toStr(row[5]);
    if (!partNumber || isDepositionMaterial(partNumber)) continue;
    const defectType = toStr(row[10]);
    if (!defectType) continue;
    const spec = toStr(row[7]);

    result.push({
      work_date: workDate,
      process: toStr(row[4]) ?? "",
      part_number: partNumber,
      shape: shapeOf(spec),
      item_name: toStr(row[6]),
      spec,
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
