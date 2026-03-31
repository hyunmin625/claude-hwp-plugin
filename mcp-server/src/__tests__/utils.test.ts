/**
 * utils.test.ts
 *
 * index.ts 내 유틸리티 함수들에 대한 단위 테스트
 *   - formatBytes  : 파일 크기 포맷
 *   - escapeRegex  : 정규식 특수문자 이스케이프
 *   - 파일 확장자 · 크기 제한 상수
 */

import { describe, it, expect } from "vitest";

// ─── index.ts와 동일한 구현체 (비공개 함수 → 테스트용 재선언) ────────────────
// NOTE: index.ts 리팩토링 시 이 섹션을 import로 교체하세요.

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const ALLOWED_EXTENSIONS = new Set([".hwp", ".hwpx", ".pdf"]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── formatBytes ─────────────────────────────────────────────────────────────

describe("formatBytes", () => {
  it("0 바이트 → '0 B'", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("1 바이트 → '1 B'", () => {
    expect(formatBytes(1)).toBe("1 B");
  });

  it("999 바이트 → '999 B'  (1 KB 미만 경계)", () => {
    expect(formatBytes(999)).toBe("999 B");
  });

  it("1023 바이트 → '1023 B'  (1 KB 미만 경계)", () => {
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("1024 바이트 → '1.0 KB'  (정확히 1 KB)", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("1536 바이트 → '1.5 KB'", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("1048575 바이트 → '1024.0 KB'  (1 MB 미만 경계)", () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  it("1048576 바이트 → '1.0 MB'  (정확히 1 MB)", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });

  it("2.5 MB → '2.5 MB'", () => {
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });

  it("500 MB → '500.0 MB'  (최대 파일 크기)", () => {
    expect(formatBytes(500 * 1024 * 1024)).toBe("500.0 MB");
  });
});

// ─── escapeRegex ─────────────────────────────────────────────────────────────

describe("escapeRegex", () => {
  it("특수문자 없는 한글 문자열 → 변경 없음", () => {
    expect(escapeRegex("홍길동")).toBe("홍길동");
  });

  it("특수문자 없는 영문 문자열 → 변경 없음", () => {
    expect(escapeRegex("hello world")).toBe("hello world");
  });

  it("점(.) 이스케이프", () => {
    expect(escapeRegex("hello.world")).toBe("hello\\.world");
  });

  it("별표(*) 이스케이프", () => {
    expect(escapeRegex("a*b")).toBe("a\\*b");
  });

  it("플러스(+) 이스케이프", () => {
    expect(escapeRegex("a+b")).toBe("a\\+b");
  });

  it("물음표(?) 이스케이프", () => {
    expect(escapeRegex("a?b")).toBe("a\\?b");
  });

  it("캐럿(^) 이스케이프", () => {
    expect(escapeRegex("^start")).toBe("\\^start");
  });

  it("달러($) 이스케이프", () => {
    expect(escapeRegex("end$")).toBe("end\\$");
  });

  it("중괄호({}) 이스케이프", () => {
    expect(escapeRegex("a{2}")).toBe("a\\{2\\}");
  });

  it("소괄호(()) 이스케이프", () => {
    expect(escapeRegex("(test)")).toBe("\\(test\\)");
  });

  it("대괄호([]) 이스케이프", () => {
    expect(escapeRegex("[value]")).toBe("\\[value\\]");
  });

  it("파이프(|) 이스케이프", () => {
    expect(escapeRegex("a|b")).toBe("a\\|b");
  });

  it("백슬래시(\\) 이스케이프", () => {
    expect(escapeRegex("a\\b")).toBe("a\\\\b");
  });

  it("복합 — 한글 라벨 + 괄호 설명", () => {
    expect(escapeRegex("생년월일(8자리)")).toBe("생년월일\\(8자리\\)");
  });

  it("복합 — No. 포함 영문 라벨", () => {
    expect(escapeRegex("No.순번")).toBe("No\\.순번");
  });

  it("복합 — 여러 특수문자", () => {
    expect(escapeRegex("a.b*c+d?")).toBe("a\\.b\\*c\\+d\\?");
  });
});

// ─── 파일 확장자 허용 목록 ───────────────────────────────────────────────────

describe("ALLOWED_EXTENSIONS", () => {
  it(".hwp 허용", () => expect(ALLOWED_EXTENSIONS.has(".hwp")).toBe(true));
  it(".hwpx 허용", () => expect(ALLOWED_EXTENSIONS.has(".hwpx")).toBe(true));
  it(".pdf 허용", () => expect(ALLOWED_EXTENSIONS.has(".pdf")).toBe(true));

  it(".docx 불허 (MS Word)", () => expect(ALLOWED_EXTENSIONS.has(".docx")).toBe(false));
  it(".doc 불허 (MS Word 레거시)", () => expect(ALLOWED_EXTENSIONS.has(".doc")).toBe(false));
  it(".txt 불허", () => expect(ALLOWED_EXTENSIONS.has(".txt")).toBe(false));
  it(".xlsx 불허", () => expect(ALLOWED_EXTENSIONS.has(".xlsx")).toBe(false));
  it(".odt 불허 (LibreOffice)", () => expect(ALLOWED_EXTENSIONS.has(".odt")).toBe(false));
  it("빈 문자열 불허", () => expect(ALLOWED_EXTENSIONS.has("")).toBe(false));
  it("대문자 .HWP 불허 (대소문자 구분)", () => expect(ALLOWED_EXTENSIONS.has(".HWP")).toBe(false));
});

// ─── 파일 크기 제한 (MAX_FILE_SIZE = 500 MB) ─────────────────────────────────

describe("MAX_FILE_SIZE (500 MB)", () => {
  it("499 MB는 허용 범위", () => {
    expect(499 * 1024 * 1024 > MAX_FILE_SIZE).toBe(false);
  });

  it("500 MB는 허용 범위 (경계)", () => {
    expect(500 * 1024 * 1024 > MAX_FILE_SIZE).toBe(false);
  });

  it("500 MB + 1 바이트는 초과", () => {
    expect(500 * 1024 * 1024 + 1 > MAX_FILE_SIZE).toBe(true);
  });

  it("501 MB는 초과", () => {
    expect(501 * 1024 * 1024 > MAX_FILE_SIZE).toBe(true);
  });

  it("1 GB는 초과", () => {
    expect(1024 * 1024 * 1024 > MAX_FILE_SIZE).toBe(true);
  });
});
