import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCoatingExcel, COATING_SHEET } from "./coating-import";
import {
  parseProductionPlanExcel,
  PRODUCTION_PLAN_SHEET,
} from "./production-plan-import";
import {
  parseHeaterCoilExcel,
  parseMeshExcel,
  HEATER_COIL_SHEET,
  MESH_SHEET,
} from "./shipment-import";
import {
  parseVmShipments,
  parseVmBacklog,
  VM_SHIPMENT_SHEET,
  VM_BACKLOG_SHEET,
} from "./vm-import";
import {
  parseConnectorRecords,
  parseConnectorDefects,
  CONNECTOR_ERP_SHEET,
  CONNECTOR_DEFECT_SHEET,
} from "./connector-import";
import {
  parseElectronBeamRecords,
  parseElectronBeamDefects,
  ELECTRON_BEAM_ERP_SHEET,
  ELECTRON_BEAM_DEFECT_SHEET,
} from "./electron-beam-import";
import {
  parseMeshQualityRecords,
  parseMeshQualityDefects,
  MESH_QUALITY_ERP_SHEET,
  MESH_QUALITY_DEFECT_SHEET,
} from "./mesh-quality-import";
import {
  parseVmQualityRecords,
  parseVmQualityDefects,
  VM_QUALITY_ERP_SHEET,
  VM_QUALITY_DEFECT_SHEET,
} from "./vm-quality-import";

/**
 * 자동 취합이 기존 데이터를 날리지 않게 하는 하한선. 엑셀이 열려 있어 잠겼거나
 * 동기화 도중 반쪽만 받아지면 행 수가 급감하는데, 사람이 결과를 보지 않는
 * 경로에서는 그게 조용한 전량 삭제가 된다. 기존 대비 이 비율 미만이면 거부한다.
 */
export const MIN_ROW_RATIO = 0.5;

export type IngestTarget = {
  /** 이 시트가 있으면 이 대상으로 판별한다. */
  sheet: string;
  /**
   * 여러 품질실적 대시보드가 전부 Power BI에서 나온 같은 시트 이름
   * ("ERPDATA", "불량ERP")을 쓰기 때문에 시트만으로는 어느 파일인지 구분이
   * 안 된다. 이 값이 있으면 파일명에 이 문자열이 들어 있어야만 이 대상으로
   * 판별한다 (예: "커넥터", "전자빔"). 시트 이름이 이미 고유한 대상은 안
   * 써도 된다.
   */
  fileNameIncludes?: string;
  table: string;
  label: string;
  /** 취합 후 캐시를 무효화할 경로. */
  path: string;
  parse: (buffer: ArrayBuffer) => object[];
  /**
   * 급감 가드의 기준. 스냅샷처럼 행 수가 원래 크게 출렁이는 표는 낮춰 잡거나
   * 0 으로 꺼야 정상 데이터가 막히지 않는다.
   */
  minRowRatio?: number;
};

export const INGEST_TARGETS: IngestTarget[] = [
  {
    sheet: COATING_SHEET,
    table: "coating_records",
    label: "코팅현황",
    path: "/coating",
    parse: parseCoatingExcel,
  },
  {
    sheet: PRODUCTION_PLAN_SHEET,
    table: "production_plan_records",
    label: "생산계획 대비 실적",
    path: "/production-plan",
    parse: parseProductionPlanExcel,
  },
  {
    sheet: HEATER_COIL_SHEET,
    table: "heater_coil_shipments",
    label: "히터코일 출하현황",
    path: "/heater-coil",
    parse: parseHeaterCoilExcel,
  },
  {
    sheet: MESH_SHEET,
    table: "mesh_shipments",
    label: "메시 출하현황",
    path: "/mesh",
    parse: parseMeshExcel,
  },
  {
    sheet: VM_SHIPMENT_SHEET,
    table: "vm_shipments",
    label: "진공증착 출하",
    path: "/vm-coil",
    parse: parseVmShipments,
  },
  {
    sheet: VM_BACKLOG_SHEET,
    table: "vm_backlog",
    label: "진공증착 수주잔량",
    path: "/vm-coil",
    parse: parseVmBacklog,
    // 당월 수주 잔량은 그 달에 남은 주문만 담은 스냅샷이라 50여 행에서
    // 한 자리로 줄어드는 게 정상이다. 급감 가드를 걸면 멀쩡한 갱신이 막힌다.
    minRowRatio: 0,
  },
  {
    sheet: CONNECTOR_ERP_SHEET,
    fileNameIncludes: "커넥터",
    table: "connector_quality_records",
    label: "커넥터 품질실적",
    path: "/connector-quality",
    parse: parseConnectorRecords,
  },
  {
    sheet: CONNECTOR_DEFECT_SHEET,
    fileNameIncludes: "커넥터",
    table: "connector_defect_details",
    label: "커넥터 불량유형",
    path: "/connector-quality",
    parse: parseConnectorDefects,
  },
  {
    sheet: ELECTRON_BEAM_ERP_SHEET,
    fileNameIncludes: "전자빔",
    table: "electron_beam_quality_records",
    label: "전자빔 품질실적",
    path: "/electron-beam-quality",
    parse: parseElectronBeamRecords,
  },
  {
    sheet: ELECTRON_BEAM_DEFECT_SHEET,
    fileNameIncludes: "전자빔",
    table: "electron_beam_defect_details",
    label: "전자빔 불량유형",
    path: "/electron-beam-quality",
    parse: parseElectronBeamDefects,
  },
  {
    sheet: MESH_QUALITY_ERP_SHEET,
    fileNameIncludes: "메시 품질실적",
    table: "mesh_quality_records",
    label: "메시 품질실적",
    path: "/mesh-quality",
    parse: parseMeshQualityRecords,
  },
  {
    sheet: MESH_QUALITY_DEFECT_SHEET,
    fileNameIncludes: "메시 품질실적",
    table: "mesh_quality_defect_details",
    label: "메시 불량유형",
    path: "/mesh-quality",
    parse: parseMeshQualityDefects,
  },
  {
    sheet: VM_QUALITY_ERP_SHEET,
    fileNameIncludes: "VM 품질실적",
    table: "vm_quality_records",
    label: "VM코일 품질실적",
    path: "/vm-quality",
    parse: parseVmQualityRecords,
  },
  {
    sheet: VM_QUALITY_DEFECT_SHEET,
    fileNameIncludes: "VM 품질실적",
    table: "vm_quality_defect_details",
    label: "VM코일 불량유형",
    path: "/vm-quality",
    parse: parseVmQualityDefects,
  },
];

/** 워크북에 들어 있는 시트(와 필요하면 파일명)를 보고 어떤 대상을 취합할지 고른다. */
export function detectTargets(
  buffer: ArrayBuffer,
  fileName?: string | null,
): IngestTarget[] {
  const { SheetNames } = XLSX.read(buffer, {
    type: "array",
    bookSheets: true,
  });
  const present = new Set(SheetNames);
  return INGEST_TARGETS.filter((t) => {
    if (!present.has(t.sheet)) return false;
    if (t.fileNameIncludes && !(fileName ?? "").includes(t.fileNameIncludes)) {
      return false;
    }
    return true;
  });
}

export class IngestError extends Error {}

/**
 * 테이블을 비우고 전량 다시 넣는다. 수만 행을 한 청크씩 처리하면 60초 예산을
 * 넘겨서 몇 개씩 묶어 올린다. 실패하면 IngestError 를 던진다.
 */
export async function replaceTable(
  supabase: SupabaseClient,
  table: string,
  rows: object[],
) {
  const { error: deleteError } = await supabase
    .from(table)
    .delete()
    .gt("id", 0);

  if (deleteError) {
    throw new IngestError(`기존 데이터 삭제 실패: ${deleteError.message}`);
  }

  const chunkSize = 1000;
  const concurrency = 4;
  const chunks: object[][] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }

  for (let i = 0; i < chunks.length; i += concurrency) {
    const group = chunks.slice(i, i + concurrency);
    const results = await Promise.all(
      group.map((chunk) => supabase.from(table).insert(chunk)),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      throw new IngestError(
        `${i * chunkSize}건째 부근 업로드 실패: ${failed.error.message}`,
      );
    }
  }

  // 비우기와 넣기가 한 덩어리로 묶여 있지 않아서, 같은 표에 업로드가 겹치면
  // 한쪽이 비우는 사이 다른 쪽이 넣어 행이 뒤섞인 채 쌓인다. 2026-07-30 에
  // 실제로 진공증착 표가 12,329행에서 29,316행으로 불어난 적이 있는데, 그때
  // 화면에는 "성공"으로 떴다. 넣은 만큼 들어갔는지 마지막에 세어 확인한다.
  const finalCount = await countRows(supabase, table);
  if (finalCount !== rows.length) {
    throw new IngestError(
      `저장 결과가 맞지 않습니다 (넣으려던 ${rows.length.toLocaleString()}건 → 실제 ${finalCount.toLocaleString()}건). ` +
        `업로드가 동시에 두 번 이상 실행됐을 수 있습니다. 잠시 뒤 한 번만 다시 올려주세요.`,
    );
  }
}

async function countRows(supabase: SupabaseClient, table: string) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw new IngestError(`행 수 조회 실패: ${error.message}`);
  return count ?? 0;
}

export async function recordSync(
  supabase: SupabaseClient,
  entry: {
    target: string;
    label: string;
    status: "ok" | "error";
    row_count: number | null;
    message: string | null;
    source: string;
    file_name: string | null;
  },
) {
  // 이력 기록 실패가 취합 자체를 실패시키지는 않게 한다.
  const { error } = await supabase.from("sync_log").insert(entry);
  if (error) console.error("sync_log insert failed", error.message);
}

export type IngestOutcome = {
  table: string;
  label: string;
  status: "ok" | "error";
  rows: number | null;
  message: string | null;
  path: string;
};

/**
 * 워크북 하나를 받아 해당하는 대상을 전부 취합한다. 대상별로 독립적으로
 * 처리하므로 하나가 실패해도 나머지는 반영된다.
 */
export async function ingestWorkbook(
  supabase: SupabaseClient,
  buffer: ArrayBuffer,
  opts: { source: string; fileName: string | null },
): Promise<IngestOutcome[]> {
  const targets = detectTargets(buffer, opts.fileName);

  if (targets.length === 0) {
    throw new IngestError(
      `알 수 있는 시트가 없습니다. 다음 중 하나가 필요합니다: ${INGEST_TARGETS.map(
        (t) => t.sheet,
      ).join(", ")}`,
    );
  }

  const outcomes: IngestOutcome[] = [];

  for (const target of targets) {
    const base = { table: target.table, label: target.label, path: target.path };
    try {
      const rows = target.parse(buffer);
      if (rows.length === 0) {
        throw new IngestError("엑셀에서 데이터를 찾을 수 없습니다.");
      }

      const ratio = target.minRowRatio ?? MIN_ROW_RATIO;
      const existing = ratio > 0 ? await countRows(supabase, target.table) : 0;
      if (existing > 0 && rows.length < existing * ratio) {
        throw new IngestError(
          `행 수가 급감했습니다 (기존 ${existing.toLocaleString()}건 → 새 파일 ${rows.length.toLocaleString()}건). ` +
            `파일이 손상되었을 수 있어 기존 데이터를 유지합니다.`,
        );
      }

      await replaceTable(supabase, target.table, rows);

      outcomes.push({ ...base, status: "ok", rows: rows.length, message: null });
      await recordSync(supabase, {
        target: target.table,
        label: target.label,
        status: "ok",
        row_count: rows.length,
        message: null,
        source: opts.source,
        file_name: opts.fileName,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "알 수 없는 오류";
      outcomes.push({ ...base, status: "error", rows: null, message });
      await recordSync(supabase, {
        target: target.table,
        label: target.label,
        status: "error",
        row_count: null,
        message,
        source: opts.source,
        file_name: opts.fileName,
      });
    }
  }

  return outcomes;
}
