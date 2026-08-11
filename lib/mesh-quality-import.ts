import * as XLSX from "xlsx";

export type MeshQualityRecordRow = {
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

export type MeshQualityDefectRow = {
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

// 품목 코드는 "PMESH0010", "PMESC0111A" 처럼 "PMES" 접두사 + 나머지(글자+숫자)
// 꼴이다. 참고 화면의 차트가 "PMES" 만 뗀 나머지("H0010", "C0111A")를 쓴다.
function partCode(partNumber: string | null): string | null {
  if (!partNumber) return null;
  return partNumber.replace(/^PMES/, "") || null;
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

export const MESH_QUALITY_ERP_SHEET = "ERPDATA";
export const MESH_QUALITY_DEFECT_SHEET = "불량ERP";

// ERPDATA 는 나주공장 전체 공정 실적이 한 시트에 섞여 있는 원본이라, 메시
// 품질 대시보드가 실제로 추적하는 2개 공정만 남긴다 (열처리 세척/세정,
// 수입검사, 표면검사 등 나머지 메시 관련 공정은 이 대시보드가 추적하지
// 않는다).
const MESH_QUALITY_PROCESSES = new Set(["출하검사", "와이어컷팅"]);

// 작업일 | 작업장 | 공정 | 품목 | 규격 | 품목명 | 단위 | 실적수량 | 불량수량 |
// 양품수량 | 비고1 | 단중(g) | 비고2 | 작업시간(H) | 작업자 | 담당자 | 대분류 |
// 중분류 | 소분류 | 작업지시번호 | 작업실적번호
export function parseMeshQualityRecords(
  buffer: ArrayBuffer,
): MeshQualityRecordRow[] {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    dense: true,
  });
  const rows = readSheet(workbook, MESH_QUALITY_ERP_SHEET, 2);

  const result: MeshQualityRecordRow[] = [];
  for (const row of rows) {
    const process = toStr(row[2]);
    if (!process || !MESH_QUALITY_PROCESSES.has(process)) continue;
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
// 불량수량 | 불량율(%) | 불량율(ppm) | 품번 추출
export function parseMeshQualityDefects(
  buffer: ArrayBuffer,
): MeshQualityDefectRow[] {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    dense: true,
  });
  const rows = readSheet(workbook, MESH_QUALITY_DEFECT_SHEET, 2);

  const result: MeshQualityDefectRow[] = [];
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
