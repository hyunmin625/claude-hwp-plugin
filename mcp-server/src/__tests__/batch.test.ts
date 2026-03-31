/**
 * batch.test.ts
 *
 * hwp_batch_fill 관련 엣지케이스 테스트
 *   1. 출력 파일명 생성 로직 (filename_field / 순번)
 *   2. 파일명 금지 문자 제거 (sanitizeFilename)
 *   3. rows Zod 스키마 검증 (min 1, max 500)
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ─── index.ts와 동일한 구현체 (비공개 로직 → 테스트용 재선언) ─────────────────

/** OS 파일명 금지 문자를 '_'로 치환 */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_");
}

/** hwp_batch_fill 내부 파일명 결정 로직 */
function getOutputFilename(
  fields: Record<string, string>,
  filenameField: string | undefined,
  templateBase: string,
  index: number
): string {
  const paddedIndex = String(index + 1).padStart(3, "0");
  const rawName =
    filenameField && fields[filenameField]
      ? sanitizeFilename(fields[filenameField])
      : `${templateBase}_${paddedIndex}`;
  return `${rawName}.hwpx`;
}

/** hwp_batch_fill rows Zod 스키마 */
const rowsSchema = z.array(z.record(z.string())).min(1).max(500);

// ─── sanitizeFilename ─────────────────────────────────────────────────────────

describe("sanitizeFilename — 파일명 금지 문자 치환", () => {
  // 정상 입력
  it("한글 이름 → 변경 없음", () => {
    expect(sanitizeFilename("홍길동")).toBe("홍길동");
  });

  it("영문 + 숫자 + 하이픈 → 변경 없음", () => {
    expect(sanitizeFilename("Hong-Gil-Dong_2026")).toBe("Hong-Gil-Dong_2026");
  });

  it("빈 문자열 → 빈 문자열", () => {
    expect(sanitizeFilename("")).toBe("");
  });

  // 각 금지 문자 개별 확인
  const forbiddenChars: [string, string][] = [
    ["/",  "슬래시(/)"],
    ["\\", "백슬래시(\\)"],
    ["?",  "물음표(?)"],
    ["%",  "퍼센트(%)"],
    ["*",  "별표(*)"],
    [":",  "콜론(:)"],
    ["|",  "파이프(|)"],
    ['"',  '큰따옴표(")'],
    ["<",  "꺾쇠 열기(<)"],
    [">",  "꺾쇠 닫기(>)"],
  ];

  for (const [char, label] of forbiddenChars) {
    it(`${label} → '_'로 치환`, () => {
      expect(sanitizeFilename(`a${char}b`)).toBe("a_b");
    });
  }

  it("복합 금지 문자 — 'file:name?v*1' → 'file_name_v_1'", () => {
    expect(sanitizeFilename("file:name?v*1")).toBe("file_name_v_1");
  });

  it("연속 금지 문자 — 'a/:b' → 'a__b'", () => {
    expect(sanitizeFilename("a/:b")).toBe("a__b");
  });

  it("금지 문자만 — '???' → '___'", () => {
    expect(sanitizeFilename("???")).toBe("___");
  });

  it("경로처럼 보이는 문자열 — 'dir/sub/file' → 'dir_sub_file'", () => {
    expect(sanitizeFilename("dir/sub/file")).toBe("dir_sub_file");
  });
});

// ─── getOutputFilename ────────────────────────────────────────────────────────

describe("getOutputFilename — 출력 파일명 결정", () => {
  describe("filename_field 미지정 → 순번 파일명", () => {
    it("첫 번째 레코드(index=0) → 'template_001.hwpx'", () => {
      expect(getOutputFilename({}, undefined, "template", 0)).toBe("template_001.hwpx");
    });

    it("열 번째 레코드(index=9) → 'form_010.hwpx'", () => {
      expect(getOutputFilename({}, undefined, "form", 9)).toBe("form_010.hwpx");
    });

    it("백 번째 레코드(index=99) → 'doc_100.hwpx'", () => {
      expect(getOutputFilename({}, undefined, "doc", 99)).toBe("doc_100.hwpx");
    });

    it("최대 500번째 레코드(index=499) → 'template_500.hwpx'", () => {
      expect(getOutputFilename({}, undefined, "template", 499)).toBe("template_500.hwpx");
    });
  });

  describe("filename_field 지정 → 필드값 파일명", () => {
    it("'성명' 필드 사용 → '홍길동.hwpx'", () => {
      expect(getOutputFilename({ 성명: "홍길동" }, "성명", "template", 0)).toBe("홍길동.hwpx");
    });

    it("'이름' 필드 사용 → 'Alice.hwpx'", () => {
      expect(getOutputFilename({ 이름: "Alice" }, "이름", "template", 0)).toBe("Alice.hwpx");
    });

    it("필드값에 금지 문자 포함 → sanitize 후 파일명", () => {
      expect(getOutputFilename({ 제목: "보고서: 2026" }, "제목", "template", 0)).toBe(
        "보고서_ 2026.hwpx"
      );
    });

    it("filename_field 가 fields 에 없으면 → 순번으로 폴백", () => {
      expect(getOutputFilename({ 성명: "홍길동" }, "이메일", "template", 0)).toBe(
        "template_001.hwpx"
      );
    });

    it("filename_field 의 값이 빈 문자열이면 → 순번으로 폴백", () => {
      expect(getOutputFilename({ 성명: "" }, "성명", "template", 0)).toBe("template_001.hwpx");
    });
  });
});

// ─── rows Zod 스키마 검증 ─────────────────────────────────────────────────────

describe("rows Zod 스키마 — min(1) / max(500) 검증", () => {
  it("빈 배열 [] → Zod 에러 (min 1 위반)", () => {
    expect(() => rowsSchema.parse([])).toThrow();
  });

  it("레코드 1개 → 허용", () => {
    expect(() => rowsSchema.parse([{ 성명: "홍길동" }])).not.toThrow();
  });

  it("레코드 100개 → 허용", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ idx: String(i) }));
    expect(() => rowsSchema.parse(rows)).not.toThrow();
  });

  it("레코드 500개 → 허용 (경계)", () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ idx: String(i) }));
    expect(() => rowsSchema.parse(rows)).not.toThrow();
  });

  it("레코드 501개 → Zod 에러 (max 500 초과)", () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ idx: String(i) }));
    expect(() => rowsSchema.parse(rows)).toThrow();
  });

  it("레코드 1000개 → Zod 에러", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ idx: String(i) }));
    expect(() => rowsSchema.parse(rows)).toThrow();
  });

  it("각 레코드는 Record<string, string> — 숫자값은 Zod 에러", () => {
    // Zod z.record(z.string()) 은 string 값만 허용
    expect(() =>
      rowsSchema.parse([{ 성명: "홍길동", 나이: 30 as unknown as string }])
    ).toThrow();
  });

  it("올바른 다중 필드 레코드 → 허용", () => {
    const rows = [
      { 성명: "홍길동", 날짜: "2026-03-30", 주소: "서울시" },
      { 성명: "김영희", 날짜: "2026-03-31", 주소: "부산시" },
    ];
    expect(() => rowsSchema.parse(rows)).not.toThrow();
  });
});

// ─── 파일명 패딩 일관성 ───────────────────────────────────────────────────────

describe("파일명 인덱스 패딩 (3자리 고정)", () => {
  const cases: [number, string][] = [
    [0,   "001"],
    [8,   "009"],
    [9,   "010"],
    [98,  "099"],
    [99,  "100"],
    [499, "500"],
  ];

  for (const [index, expected] of cases) {
    it(`index=${index} → 순번 '${expected}'`, () => {
      const filename = getOutputFilename({}, undefined, "f", index);
      expect(filename).toBe(`f_${expected}.hwpx`);
    });
  }
});
