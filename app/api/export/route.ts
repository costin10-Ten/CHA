import { NextResponse } from "next/server";

import { buildCandidatePack } from "@shared/pack.ts";

import {
  loadCandidatePackFacts,
  loadDocumentExport,
  loadFactBundle,
} from "@/lib/export/queries";
import {
  CONTENT_TYPE,
  exportFilename,
  isExportFormat,
  serializeDocument,
  serializeFacts,
  serializeMapping,
  type ExportFormat,
} from "@/lib/export/serialize";
import { getCurrentUser } from "@/lib/supabase/server";
import type {
  CandidateStatus,
  KnowledgeType,
  RiskLevel,
} from "@/lib/supabase/types";

/**
 * 匯出（工作單第 17 節）。
 *
 * 用 Route Handler 而不是 Server Action，因為要直接回傳附檔案名稱的下載回應。
 * 資料一律走使用者 session，RLS 保證只匯得到自己的資料。
 */

export const dynamic = "force-dynamic";

const KINDS = ["facts", "mapping", "document", "candidates"] as const;
type ExportKind = (typeof KINDS)[number];

function isKind(value: string): value is ExportKind {
  return (KINDS as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "尚未登入" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") ?? "facts";
  const format = params.get("format") ?? "json";
  const sourceId = params.get("source") || undefined;

  if (!isKind(kind)) {
    return NextResponse.json(
      { error: `不支援的匯出類型：${kind}` },
      { status: 400 },
    );
  }
  if (!isExportFormat(format)) {
    return NextResponse.json({ error: `不支援的格式：${format}` }, { status: 400 });
  }

  try {
    const { body, filename, contentType } = await build(kind, format, {
      sourceId,
      status: (params.get("status") as CandidateStatus) || undefined,
      riskLevel: (params.get("risk") as RiskLevel) || undefined,
      knowledgeType: (params.get("type") as KnowledgeType) || undefined,
      flag: params.get("flag") || undefined,
    });

    return new NextResponse(body, {
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "匯出失敗" },
      { status: 500 },
    );
  }
}

interface BuildOptions {
  sourceId?: string;
  status?: CandidateStatus;
  riskLevel?: RiskLevel;
  knowledgeType?: KnowledgeType;
  flag?: string;
}

async function build(
  kind: ExportKind,
  format: ExportFormat,
  options: BuildOptions,
): Promise<{ body: string; filename: string; contentType: string }> {
  if (kind === "document") {
    if (!options.sourceId) throw new Error("匯出單篇文件時必須指定 source");

    const input = await loadDocumentExport(options.sourceId);
    return {
      body: serializeDocument(input, format),
      filename: exportFilename(`document-${input.source.title}`, format),
      contentType: CONTENT_TYPE[format],
    };
  }

  if (kind === "candidates") {
    // 待選事實包一律是 JSON：內含欄位說明與校正目標，其他格式承載不了。
    const facts = await loadCandidatePackFacts({
      sourceId: options.sourceId,
      status: options.status ?? "pending",
      riskLevel: options.riskLevel,
      knowledgeType: options.knowledgeType,
      flag: options.flag,
    });

    const scope = options.sourceId
      ? `來源文件 ${options.sourceId} 的${options.status ?? "pending"}候選事實`
      : `全部${options.status ?? "pending"}候選事實`;

    const pack = buildCandidatePack(facts, { scope });
    return {
      body: `${JSON.stringify(pack, null, 2)}\n`,
      filename: exportFilename("candidate-fact-pack", "json"),
      contentType: CONTENT_TYPE.json,
    };
  }

  const bundle = await loadFactBundle(options.sourceId);

  if (kind === "mapping") {
    return {
      body: serializeMapping(bundle, format),
      filename: exportFilename("fact-source-mapping", format),
      contentType: CONTENT_TYPE[format],
    };
  }

  return {
    body: serializeFacts(bundle, format),
    filename: exportFilename("knowledge-facts", format),
    contentType: CONTENT_TYPE[format],
  };
}
