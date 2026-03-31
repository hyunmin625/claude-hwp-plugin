#!/usr/bin/env node
/**
 * claude-hwp-plugin MCP Server
 *
 * kordoc(https://github.com/chrisryugj/kordoc) 라이브러리를 기반으로
 * HWP/HWPX 한글 문서를 완전히 제어하는 MCP 서버.
 *
 * 제공 도구:
 *   hwp_parse          - HWP/HWPX/PDF → 마크다운 + 구조화 블록
 *   hwp_detect_format  - 파일 포맷 감지 (magic bytes)
 *   hwp_extract_form   - 양식(서식) 필드 추출
 *   hwp_fill_form      - 양식 템플릿에 데이터 채워 HWPX 생성
 *   hwp_batch_fill     - 다수 레코드 일괄 양식 채우기
 *   hwp_create         - 마크다운 → 새 HWPX 파일 생성
 *   hwp_compare        - 두 문서 비교 (diff)
 *   hwp_metadata       - 메타데이터만 빠르게 추출
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve, extname, join, basename } from "path";
import {
  parse,
  detectFormat,
  extractFormFields,
  markdownToHwpx,
  compare,
} from "kordoc";

// ─────────────────────────────────────────────
// 유틸리티
// ─────────────────────────────────────────────

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ALLOWED_EXTENSIONS = new Set([".hwp", ".hwpx", ".pdf"]);

async function readDocumentFile(filePath: string): Promise<ArrayBuffer> {
  const resolved = resolve(filePath);
  const ext = extname(resolved).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `지원하지 않는 파일 형식입니다: ${ext}. 허용 형식: .hwp, .hwpx, .pdf`
    );
  }

  const buffer = await readFile(resolved);
  if (buffer.byteLength > MAX_FILE_SIZE) {
    throw new Error(`파일이 너무 큽니다: ${buffer.byteLength} bytes (최대 500MB)`);
  }

  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─────────────────────────────────────────────
// MCP 서버 초기화
// ─────────────────────────────────────────────

const server = new McpServer({
  name: "claude-hwp-plugin",
  version: "0.1.0",
});

// ─────────────────────────────────────────────
// 도구 1: hwp_parse — 문서 파싱 → 마크다운
// ─────────────────────────────────────────────

server.registerTool(
  "hwp_parse",
  {
    description:
      "HWP, HWPX, PDF 문서를 마크다운 텍스트와 구조화된 블록(IRBlock[])으로 변환합니다. " +
      "문서 내용 읽기, 텍스트 추출, AI 분석에 사용하세요.",
    inputSchema: z.object({
      file_path: z.string().describe("읽을 HWP/HWPX/PDF 파일의 절대 경로 또는 상대 경로"),
      pages: z
        .string()
        .optional()
        .describe('파싱할 페이지 범위. 예: "1-3", "1,3,5-7" (미지정시 전체)'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ file_path, pages }) => {
    const buffer = await readDocumentFile(file_path);
    const result = await parse(buffer, pages ? { pages } : undefined);

    if (!result.success) {
      return {
        content: [
          {
            type: "text",
            text: `❌ 파싱 실패\n코드: ${result.error}`,
          },
        ],
        isError: true,
      };
    }

    const summary = [
      `✅ 파싱 완료: ${file_path}`,
      `📄 페이지 수: ${result.pageCount ?? "알 수 없음"}`,
      `📝 블록 수: ${result.blocks.length}`,
      result.metadata?.title ? `📌 제목: ${result.metadata.title}` : null,
      result.metadata?.author ? `👤 작성자: ${result.metadata.author}` : null,
      result.warnings?.length
        ? `⚠️  경고 ${result.warnings.length}건 (일부 요소 스킵)`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      content: [
        { type: "text", text: summary },
        { type: "text", text: "\n---\n\n" + result.markdown },
      ],
      structuredContent: {
        success: true,
        markdown: result.markdown,
        blocks: result.blocks,
        metadata: result.metadata,
        pageCount: result.pageCount,
        warnings: result.warnings,
      },
    };
  }
);

// ─────────────────────────────────────────────
// 도구 2: hwp_detect_format — 포맷 감지
// ─────────────────────────────────────────────

server.registerTool(
  "hwp_detect_format",
  {
    description:
      "파일의 매직 바이트를 분석하여 실제 포맷(hwp, hwpx, pdf, unknown)을 감지합니다. " +
      "확장자가 잘못된 파일이나 포맷 확인이 필요할 때 사용하세요.",
    inputSchema: z.object({
      file_path: z.string().describe("확인할 파일 경로"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ file_path }) => {
    const buffer = await readDocumentFile(file_path);
    const format = detectFormat(buffer);

    const formatKo: Record<string, string> = {
      hwpx: "HWPX (한컴 2020 이상, ZIP+XML 기반)",
      hwp: "HWP 5.x (레거시 바이너리 포맷)",
      pdf: "PDF",
      unknown: "알 수 없는 포맷",
    };

    return {
      content: [
        {
          type: "text",
          text: `파일 포맷: ${format}\n설명: ${formatKo[format] ?? format}\n경로: ${file_path}\n크기: ${formatBytes(buffer.byteLength)}`,
        },
      ],
      structuredContent: { format, filePath: file_path, sizeBytes: buffer.byteLength },
    };
  }
);

// ─────────────────────────────────────────────
// 도구 3: hwp_extract_form — 양식 필드 추출
// ─────────────────────────────────────────────

server.registerTool(
  "hwp_extract_form",
  {
    description:
      "HWP/HWPX 문서에서 양식(서식) 필드를 추출합니다. " +
      "라벨-값 쌍으로 구성된 정부 서식, 신청서, 보고서 등의 필드를 인식합니다. " +
      "hwp_fill_form 사용 전 템플릿의 필드를 확인할 때 사용하세요.",
    inputSchema: z.object({
      file_path: z.string().describe("양식 파일 경로 (.hwp 또는 .hwpx)"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ file_path }) => {
    const buffer = await readDocumentFile(file_path);
    const result = await parse(buffer);

    if (!result.success) {
      return {
        content: [
          {
            type: "text",
            text: `❌ 파싱 실패: ${result.error}`,
          },
        ],
        isError: true,
      };
    }

    const formResult = extractFormFields(result.blocks);
    const confidence = Math.round(formResult.confidence * 100);

    const fieldLines = formResult.fields.map(
      (f, i) =>
        `  ${i + 1}. [${f.label}] 현재값: "${f.value ?? "(빈칸)"}"`
    );

    const text =
      fieldLines.length > 0
        ? [
            `✅ 양식 필드 ${formResult.fields.length}개 발견 (신뢰도: ${confidence}%)`,
            "",
            "📋 필드 목록:",
            ...fieldLines,
            "",
            "💡 hwp_fill_form 도구로 이 필드들을 채울 수 있습니다.",
          ].join("\n")
        : `⚠️  양식 필드를 찾지 못했습니다. 이 문서는 일반 문서이거나 인식할 수 없는 양식 구조입니다.`;

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        fields: formResult.fields,
        confidence: formResult.confidence,
        fieldCount: formResult.fields.length,
      },
    };
  }
);

// ─────────────────────────────────────────────
// 도구 4: hwp_fill_form — 양식 채우기 → HWPX 생성
// ─────────────────────────────────────────────

server.registerTool(
  "hwp_fill_form",
  {
    description:
      "HWP/HWPX 양식 템플릿에 데이터를 채워 새 HWPX 파일을 생성합니다. " +
      "먼저 hwp_extract_form으로 필드를 확인한 후 사용하세요. " +
      "작성된 HWPX 파일을 output_path에 저장합니다.",
    inputSchema: z.object({
      template_path: z.string().describe("채울 양식 템플릿 파일 경로 (.hwp 또는 .hwpx)"),
      output_path: z.string().describe("생성할 HWPX 파일 저장 경로 (예: ./output/filled.hwpx)"),
      fields: z
        .record(z.string())
        .describe(
          '채울 필드 데이터. 키=라벨명, 값=입력값. 예: { "성명": "홍길동", "날짜": "2026-03-30" }'
        ),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({ template_path, output_path, fields }) => {
    // 1. 템플릿 파싱
    const buffer = await readDocumentFile(template_path);
    const parseResult = await parse(buffer);

    if (!parseResult.success) {
      return {
        content: [
          {
            type: "text",
            text: `❌ 템플릿 파싱 실패: ${parseResult.error}`,
          },
        ],
        isError: true,
      };
    }

    // 2. 양식 필드 추출
    const formResult = extractFormFields(parseResult.blocks);

    // 3. 마크다운에 필드 값 치환
    let filledMarkdown = parseResult.markdown;
    const applied: string[] = [];
    const notFound: string[] = [];

    for (const [label, value] of Object.entries(fields)) {
      // 빈칸 패턴: "라벨: ___", "라벨: ( )", "라벨: [   ]" 등
      const patterns = [
        new RegExp(`(${escapeRegex(label)}\\s*[:：]\\s*)(_{2,}|\\(\\s*\\)|\\[\\s*\\]|　+|\\s{2,})`, "gi"),
        new RegExp(`(\\|\\s*${escapeRegex(label)}\\s*\\|\\s*)(_{2,}|\\s*)(\\s*\\|)`, "gi"),
      ];

      let replaced = false;
      for (const pattern of patterns) {
        const prev = filledMarkdown;
        filledMarkdown = filledMarkdown.replace(pattern, (match, prefix, blank, suffix) => {
          if (suffix !== undefined) return `${prefix}${value}${suffix}`;
          return `${prefix}${value}`;
        });
        if (filledMarkdown !== prev) {
          replaced = true;
          break;
        }
      }

      // 패턴 치환 실패 시 extractFormFields 결과에서 찾아 직접 치환
      if (!replaced) {
        const field = formResult.fields.find(
          (f) => f.label.trim() === label.trim()
        );
        if (field && field.value !== undefined) {
          filledMarkdown = filledMarkdown.replace(
            field.value || "　",
            value
          );
          replaced = true;
        }
      }

      if (replaced) {
        applied.push(label);
      } else {
        notFound.push(label);
      }
    }

    // 4. HWPX 생성
    const hwpxBuffer = await markdownToHwpx(filledMarkdown);
    const resolvedOutput = resolve(output_path);
    await writeFile(resolvedOutput, Buffer.from(hwpxBuffer));

    const resultLines = [
      `✅ 양식 채우기 완료!`,
      `📁 저장 위치: ${resolvedOutput}`,
      `📊 파일 크기: ${formatBytes(hwpxBuffer.byteLength)}`,
      "",
      applied.length > 0
        ? `✔ 채워진 필드 (${applied.length}개): ${applied.join(", ")}`
        : null,
      notFound.length > 0
        ? `⚠️  인식 못한 필드 (${notFound.length}개): ${notFound.join(", ")}\n   → hwp_extract_form으로 정확한 라벨명을 확인하세요.`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      content: [{ type: "text", text: resultLines }],
      structuredContent: {
        outputPath: resolvedOutput,
        sizeBytes: hwpxBuffer.byteLength,
        appliedFields: applied,
        notFoundFields: notFound,
      },
    };
  }
);

// ─────────────────────────────────────────────
// 도구 5: hwp_create — 마크다운 → 새 HWPX 생성
// ─────────────────────────────────────────────

server.registerTool(
  "hwp_create",
  {
    description:
      "마크다운 텍스트로부터 새로운 HWPX 문서를 생성합니다. " +
      "제목(# 헤딩), 단락, 표(| 구분자), 목록(-, 1.)을 지원합니다. " +
      "한글 문서를 처음부터 만들 때 사용하세요.",
    inputSchema: z.object({
      markdown: z.string().describe("HWPX로 변환할 마크다운 내용"),
      output_path: z
        .string()
        .describe("저장할 HWPX 파일 경로 (예: ./documents/report.hwpx)"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({ markdown, output_path }) => {
    const hwpxBuffer = await markdownToHwpx(markdown);
    const resolvedOutput = resolve(output_path);
    await writeFile(resolvedOutput, Buffer.from(hwpxBuffer));

    return {
      content: [
        {
          type: "text",
          text: [
            `✅ HWPX 파일 생성 완료!`,
            `📁 저장 위치: ${resolvedOutput}`,
            `📊 파일 크기: ${formatBytes(hwpxBuffer.byteLength)}`,
            `📝 입력 마크다운: ${markdown.length} 자`,
          ].join("\n"),
        },
      ],
      structuredContent: {
        outputPath: resolvedOutput,
        sizeBytes: hwpxBuffer.byteLength,
      },
    };
  }
);

// ─────────────────────────────────────────────
// 도구 6: hwp_compare — 두 문서 비교
// ─────────────────────────────────────────────

server.registerTool(
  "hwp_compare",
  {
    description:
      "두 HWP/HWPX/PDF 문서를 비교하여 추가/삭제/수정된 내용을 보여줍니다. " +
      "서로 다른 포맷(예: HWP vs HWPX) 간 비교도 지원합니다. " +
      "문서 개정 내역 확인, 버전 비교에 활용하세요.",
    inputSchema: z.object({
      file_path_a: z.string().describe("비교 기준 문서 경로 (이전 버전)"),
      file_path_b: z.string().describe("비교 대상 문서 경로 (새 버전)"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ file_path_a, file_path_b }) => {
    const [bufferA, bufferB] = await Promise.all([
      readDocumentFile(file_path_a),
      readDocumentFile(file_path_b),
    ]);

    const diff = await compare(bufferA, bufferB);
    const { stats, diffs } = diff;

    const summary = [
      `📊 비교 결과`,
      `  추가: ${stats.added}개 블록`,
      `  삭제: ${stats.removed}개 블록`,
      `  수정: ${stats.modified}개 블록`,
      `  동일: ${stats.unchanged}개 블록`,
    ].join("\n");

    const diffLines = diffs
      .filter((d) => d.type !== "unchanged")
      .slice(0, 50)
      .map((d) => {
        const icon = d.type === "added" ? "➕" : d.type === "removed" ? "➖" : "✏️ ";
        const text =
          d.after?.text ?? d.before?.text ?? "(내용 없음)";
        return `${icon} [${d.type}] ${text.substring(0, 100)}${text.length > 100 ? "…" : ""}`;
      })
      .join("\n");

    return {
      content: [
        { type: "text", text: summary },
        { type: "text", text: diffLines ? "\n\n변경 내역:\n" + diffLines : "\n변경 없음" },
      ],
      structuredContent: { stats, diffs },
    };
  }
);

// ─────────────────────────────────────────────
// 도구 7: hwp_metadata — 메타데이터 빠른 추출
// ─────────────────────────────────────────────

server.registerTool(
  "hwp_metadata",
  {
    description:
      "HWP/HWPX 문서의 메타데이터(제목, 작성자, 날짜, 페이지 수 등)만 빠르게 추출합니다. " +
      "전체 문서 파싱 없이 기본 정보만 필요할 때 사용하세요.",
    inputSchema: z.object({
      file_path: z.string().describe("메타데이터를 추출할 파일 경로"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ file_path }) => {
    const buffer = await readDocumentFile(file_path);
    // 빠른 파싱을 위해 1페이지만 파싱
    const result = await parse(buffer, { pages: "1" });

    if (!result.success) {
      return {
        content: [
          { type: "text", text: `❌ 파싱 실패: ${result.error}` },
        ],
        isError: true,
      };
    }

    const meta = result.metadata;
    const lines = [
      `📄 파일: ${file_path}`,
      `📊 크기: ${formatBytes(buffer.byteLength)}`,
      meta?.title      ? `📌 제목: ${meta.title}` : null,
      meta?.author     ? `👤 작성자: ${meta.author}` : null,
      meta?.creator    ? `🖊️  생성 프로그램: ${meta.creator}` : null,
      meta?.createdAt  ? `📅 생성일: ${meta.createdAt}` : null,
      meta?.modifiedAt ? `📅 수정일: ${meta.modifiedAt}` : null,
      result.pageCount ? `📃 페이지 수: ${result.pageCount}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      content: [{ type: "text", text: lines }],
      structuredContent: { metadata: meta, pageCount: result.pageCount, sizeBytes: buffer.byteLength },
    };
  }
);

// ─────────────────────────────────────────────
// 도구 8: hwp_batch_fill — 다수 레코드 일괄 양식 채우기
// ─────────────────────────────────────────────

server.registerTool(
  "hwp_batch_fill",
  {
    description:
      "하나의 HWP/HWPX 양식 템플릿에 여러 레코드(rows)를 일괄 적용하여 " +
      "각 레코드마다 별도의 HWPX 파일을 생성합니다. " +
      "예: 100명의 신청서를 한 번에 생성할 때 사용하세요. " +
      "output_dir에 레코드별로 파일이 저장됩니다.",
    inputSchema: z.object({
      template_path: z.string().describe("채울 양식 템플릿 파일 경로 (.hwp 또는 .hwpx)"),
      output_dir: z.string().describe("생성된 HWPX 파일들을 저장할 디렉토리 경로"),
      rows: z
        .array(z.record(z.string()))
        .min(1)
        .max(500)
        .describe(
          "레코드 배열. 각 레코드는 { 필드명: 값 } 형태. " +
          '예: [{ "성명": "홍길동", "날짜": "2026-01-01" }, { "성명": "김영희", "날짜": "2026-01-02" }]'
        ),
      filename_field: z
        .string()
        .optional()
        .describe(
          "출력 파일명을 결정할 필드명. 미지정 시 001.hwpx, 002.hwpx ... 로 저장됩니다. " +
          '예: "성명" → 홍길동.hwpx'
        ),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ template_path, output_dir, rows, filename_field }) => {
    // 1. 템플릿 파싱
    const buffer = await readDocumentFile(template_path);
    const parseResult = await parse(buffer);

    if (!parseResult.success) {
      return {
        content: [
          {
            type: "text",
            text: `❌ 템플릿 파싱 실패: ${parseResult.error}`,
          },
        ],
        isError: true,
      };
    }

    // 2. 출력 디렉토리 생성
    const resolvedDir = resolve(output_dir);
    await mkdir(resolvedDir, { recursive: true });

    const templateBase = basename(template_path, extname(template_path));
    const results: Array<{ index: number; file: string; success: boolean; error?: string }> = [];
    const errors: string[] = [];

    // 3. 레코드별 파일 생성
    for (let i = 0; i < rows.length; i++) {
      const fields = rows[i];
      const formResult = extractFormFields(parseResult.blocks);

      // 마크다운에 필드 값 치환
      let filledMarkdown = parseResult.markdown;

      for (const [label, value] of Object.entries(fields)) {
        const patterns = [
          new RegExp(`(${escapeRegex(label)}\\s*[:：]\\s*)(_{2,}|\\(\\s*\\)|\\[\\s*\\]|　+|\\s{2,})`, "gi"),
          new RegExp(`(\\|\\s*${escapeRegex(label)}\\s*\\|\\s*)(_{2,}|\\s*)(\\s*\\|)`, "gi"),
        ];

        let replaced = false;
        for (const pattern of patterns) {
          const prev = filledMarkdown;
          filledMarkdown = filledMarkdown.replace(pattern, (_match, prefix, _blank, suffix) => {
            if (suffix !== undefined) return `${prefix}${value}${suffix}`;
            return `${prefix}${value}`;
          });
          if (filledMarkdown !== prev) { replaced = true; break; }
        }

        if (!replaced) {
          const field = formResult.fields.find((f) => f.label.trim() === label.trim());
          if (field && field.value !== undefined) {
            filledMarkdown = filledMarkdown.replace(field.value || "　", value);
          }
        }
      }

      // 출력 파일명 결정
      const paddedIndex = String(i + 1).padStart(3, "0");
      const rawName = filename_field && fields[filename_field]
        ? fields[filename_field].replace(/[/\\?%*:|"<>]/g, "_") // 파일명 금지 문자 제거
        : `${templateBase}_${paddedIndex}`;
      const outputFile = join(resolvedDir, `${rawName}.hwpx`);

      try {
        const hwpxBuffer = await markdownToHwpx(filledMarkdown);
        await writeFile(outputFile, Buffer.from(hwpxBuffer));
        results.push({ index: i + 1, file: outputFile, success: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ index: i + 1, file: outputFile, success: false, error: msg });
        errors.push(`[${i + 1}] ${msg}`);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.length - successCount;

    const lines = [
      `✅ 일괄 생성 완료!`,
      `📁 저장 디렉토리: ${resolvedDir}`,
      `📊 총 ${rows.length}개 중 성공 ${successCount}개 / 실패 ${failCount}개`,
      "",
      "생성된 파일:",
      ...results.slice(0, 20).map((r) =>
        r.success
          ? `  ✔ [${r.index}] ${r.file}`
          : `  ✖ [${r.index}] 실패: ${r.error}`
      ),
      results.length > 20 ? `  ... 외 ${results.length - 20}개` : null,
      errors.length > 0 ? `\n⚠️  오류 상세:\n${errors.join("\n")}` : null,
    ]
      .filter((l) => l !== null)
      .join("\n");

    return {
      content: [{ type: "text", text: lines }],
      structuredContent: {
        outputDir: resolvedDir,
        totalCount: rows.length,
        successCount,
        failCount,
        files: results,
      },
    };
  }
);

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─────────────────────────────────────────────
// 서버 시작
// ─────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("claude-hwp-plugin MCP Server 시작됨 (stdio)");
