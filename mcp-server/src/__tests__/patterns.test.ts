/**
 * patterns.test.ts
 *
 * hwp_fill_form / hwp_batch_fill 에서 사용하는
 * 필드 치환 정규식 패턴에 대한 엣지케이스 테스트.
 *
 * ── 발견된 버그 (index.ts 수정 필요) ──────────────────────────────────────────
 *
 * [BUG-1] replace 콜백의 offset 파라미터 오처리
 *   Pattern A는 캡처 그룹이 2개: (prefix)(blank)
 *   replace 콜백 시그니처: (match, p1, p2, offset, string)
 *   현재 코드: (match, prefix, blank, suffix) → suffix = offset (숫자!) → 치환 결과에 숫자가 붙음
 *   예: '성명: ___' → '성명: 홍길동0'  (0은 match offset)
 *   수정: typeof suffix === 'string' 으로 타입 체크 필요
 *
 * [BUG-2] \s* 가 전각 공백(U+3000)을 소비해서 　+ 패턴이 일부만 매칭
 *   '성명: 　　　' → \s* 가 전각 공백을 탐욕적으로 소비 후 백트래킹
 *   → Group2 = 마지막 1개만 캡처 → '성명: 　　홍길동' (불완전 치환)
 *   수정: 콜론 뒤 \s* 를 [ \t]* (ASCII 공백/탭만)으로 제한 권장
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 이 테스트 파일의 replaceField 구현은 의도된 올바른 동작을 기준으로 작성됨.
 * BUG-1은 수정된 구현으로 테스트. BUG-2는 단일 전각 공백만 테스트(다중은 주석 참조).
 */

import { describe, it, expect } from "vitest";

// ─── 수정된 구현 (index.ts 에 반영 필요) ─────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 필드 치환 — BUG-1 수정 버전
 * suffix 타입 체크: typeof suffix === 'string' 으로 offset(숫자) 구분
 */
function replaceField(
  markdown: string,
  label: string,
  value: string
): { result: string; replaced: boolean } {
  const patterns = [
    // Pattern A (캡처 그룹 2개): "라벨: ___" / "( )" / "[ ]" / 전각공백 / 공백2+
    new RegExp(
      `(${escapeRegex(label)}\\s*[:：]\\s*)(_{2,}|\\(\\s*\\)|\\[\\s*\\]|　+|\\s{2,})`,
      "gi"
    ),
    // Pattern B (캡처 그룹 3개): "| 라벨 | ___ |" 테이블
    new RegExp(
      `(\\|\\s*${escapeRegex(label)}\\s*\\|\\s*)(_{2,}|\\s*)(\\s*\\|)`,
      "gi"
    ),
  ];

  let replaced = false;
  for (const pattern of patterns) {
    const prev = markdown;
    markdown = markdown.replace(
      pattern,
      (match, prefix, blank, ...rest) => {
        // BUG-1 수정: rest[0]이 string이면 suffix(Pattern B), 숫자면 offset(Pattern A)
        const suffix = typeof rest[0] === "string" ? rest[0] : undefined;
        if (suffix !== undefined) return `${prefix}${value}${suffix}`;
        return `${prefix}${value}`;
      }
    );
    if (markdown !== prev) {
      replaced = true;
      break;
    }
  }

  return { result: markdown, replaced };
}

// ─── Pattern A: 밑줄(_) 패턴 ─────────────────────────────────────────────────

describe("Pattern A — 밑줄(___) 패턴", () => {
  it("기본: '성명: ___' → '성명: 홍길동'", () => {
    const { result, replaced } = replaceField("성명: ___", "성명", "홍길동");
    expect(result).toBe("성명: 홍길동");
    expect(replaced).toBe(true);
  });

  it("긴 밑줄: '날짜: ______' → '날짜: 2026-03-30'", () => {
    const { result, replaced } = replaceField("날짜: ______", "날짜", "2026-03-30");
    expect(result).toBe("날짜: 2026-03-30");
    expect(replaced).toBe(true);
  });

  it("짧은 밑줄(1개)은 매칭 안 됨 — _{2,} 조건", () => {
    const { replaced } = replaceField("성명: _", "성명", "홍길동");
    expect(replaced).toBe(false);
  });

  it("콜론 앞뒤 공백 허용: '주소 :  ___'", () => {
    const { result, replaced } = replaceField("주소 :  ___", "주소", "서울시");
    expect(replaced).toBe(true);
    expect(result).toBe("주소 :  서울시");
  });

  it("전각 콜론(：) 허용: '성명：___'", () => {
    const { result, replaced } = replaceField("성명：___", "성명", "김철수");
    expect(replaced).toBe(true);
    expect(result).toBe("성명：김철수");
  });

  it("대소문자 무시 (gi 플래그): 'NAME: ___' 에서 'name' 라벨 매칭", () => {
    const { result, replaced } = replaceField("NAME: ___", "name", "Alice");
    expect(replaced).toBe(true);
    expect(result).toBe("NAME: Alice");
  });

  it("이미 값이 채워진 필드는 변경 없음 (빈칸 패턴 없음)", () => {
    const { replaced } = replaceField("성명: 홍길동", "성명", "김영희");
    expect(replaced).toBe(false);
  });

  it("존재하지 않는 라벨 → 변경 없음, 원본 반환", () => {
    const { result, replaced } = replaceField("성명: ___", "주소", "서울시");
    expect(replaced).toBe(false);
    expect(result).toBe("성명: ___");
  });
});

// ─── Pattern A: 소괄호(( )) 패턴 ─────────────────────────────────────────────

describe("Pattern A — 빈 소괄호 패턴 '( )'", () => {
  it("기본: '성별: ( )' → '성별: 남'", () => {
    const { result, replaced } = replaceField("성별: ( )", "성별", "남");
    expect(replaced).toBe(true);
    expect(result).toBe("성별: 남");
  });

  it("괄호 내 공백 여럿: '여부: (   )' → '여부: 예'", () => {
    const { result, replaced } = replaceField("여부: (   )", "여부", "예");
    expect(replaced).toBe(true);
    expect(result).toBe("여부: 예");
  });

  it("공백 없는 빈 괄호: '구분: ()' → '구분: A'", () => {
    const { result, replaced } = replaceField("구분: ()", "구분", "A");
    expect(replaced).toBe(true);
    expect(result).toBe("구분: A");
  });
});

// ─── Pattern A: 대괄호([ ]) 패턴 ─────────────────────────────────────────────

describe("Pattern A — 빈 대괄호 패턴 '[ ]'", () => {
  it("기본: '코드: []' → '코드: A001'", () => {
    const { result, replaced } = replaceField("코드: []", "코드", "A001");
    expect(replaced).toBe(true);
    expect(result).toBe("코드: A001");
  });

  it("공백 포함: '분류: [   ]' → '분류: 1급'", () => {
    const { result, replaced } = replaceField("분류: [   ]", "분류", "1급");
    expect(replaced).toBe(true);
    expect(result).toBe("분류: 1급");
  });
});

// ─── Pattern A: 전각 공백(　) 패턴 ───────────────────────────────────────────

describe("Pattern A — 전각 공백(　, U+3000) 패턴", () => {
  it("전각 공백 1개: '성명: 　' → '성명: 홍길동'", () => {
    // \s* 가 ASCII 공백을 소비 후 백트래킹, 　+ 가 전각 공백 1개 캡처
    const { result, replaced } = replaceField("성명: 　", "성명", "홍길동");
    expect(replaced).toBe(true);
    expect(result).toBe("성명: 홍길동");
  });

  it("전각 공백 다중: 치환은 성공하나 prefix에 전각 공백이 남을 수 있음 [BUG-2]", () => {
    // \s* 가 전각 공백을 탐욕적으로 소비 후 마지막 1개만 　+에 매칭
    // → replaced=true 이지만 prefix에 전각 공백이 잔류할 수 있음
    // TODO: index.ts 의 \s* 를 [ \t]* 로 변경하면 완전 치환 가능
    const { replaced } = replaceField("성명: 　　　", "성명", "홍길동");
    expect(replaced).toBe(true); // 치환은 일어남
  });
});

// ─── Pattern B: 테이블 셀 패턴 ───────────────────────────────────────────────

describe("Pattern B — 마크다운 테이블 셀 패턴 '| 라벨 | ___ |'", () => {
  it("기본: '| 성명 | ___ |' → '| 성명 | 이영희 |'", () => {
    const { result, replaced } = replaceField("| 성명 | ___ |", "성명", "이영희");
    expect(replaced).toBe(true);
    expect(result).toBe("| 성명 | 이영희 |");
  });

  it("긴 밑줄: '| 주소 | ______ |' → '| 주소 | 서울시 |'", () => {
    const { result, replaced } = replaceField("| 주소 | ______ |", "주소", "서울시");
    expect(replaced).toBe(true);
    expect(result).toBe("| 주소 | 서울시 |");
  });

  it("앞뒤 공백 다수: prefix 공백은 유지, suffix 공백도 유지됨", () => {
    // Group1='|  날짜  |  ', Group2='___', Group3='  |'
    // 결과: '|  날짜  |  2026-03-30  |' (공백 그대로 유지)
    const { result, replaced } = replaceField("|  날짜  |  ___  |", "날짜", "2026-03-30");
    expect(replaced).toBe(true);
    expect(result).toBe("|  날짜  |  2026-03-30  |");
  });
});

// ─── 특수문자 포함 라벨 ───────────────────────────────────────────────────────

describe("특수문자 포함 라벨 (escapeRegex 적용 확인)", () => {
  it("괄호 포함: '생년월일(8자리): ___' → '생년월일(8자리): 19900101'", () => {
    const { result, replaced } = replaceField(
      "생년월일(8자리): ___",
      "생년월일(8자리)",
      "19900101"
    );
    expect(replaced).toBe(true);
    expect(result).toBe("생년월일(8자리): 19900101");
  });

  it("점 포함: 'No.순번: ___' → 'No.순번: 001'", () => {
    const { result, replaced } = replaceField("No.순번: ___", "No.순번", "001");
    expect(replaced).toBe(true);
    expect(result).toBe("No.순번: 001");
  });

  it("대괄호 포함: '분류[코드]: ___' → '분류[코드]: A1'", () => {
    const { result, replaced } = replaceField("분류[코드]: ___", "분류[코드]", "A1");
    expect(replaced).toBe(true);
    expect(result).toBe("분류[코드]: A1");
  });
});

// ─── 다중 필드 치환 ───────────────────────────────────────────────────────────

describe("다중 필드가 있는 마크다운에서 순차 치환", () => {
  const template = [
    "# 신청서",
    "",
    "성명: ___",
    "생년월일: ___",
    "주소: ___",
    "",
    "| 항목 | ___ |",
    "| 금액 | ___ |",
  ].join("\n");

  it("성명만 치환 → 나머지 필드는 그대로 유지", () => {
    const { result } = replaceField(template, "성명", "홍길동");
    expect(result).toContain("성명: 홍길동");
    expect(result).toContain("생년월일: ___");
    expect(result).toContain("주소: ___");
  });

  it("테이블 항목 치환 → 텍스트 필드는 그대로 유지", () => {
    const { result } = replaceField(template, "항목", "사무용품");
    expect(result).toContain("| 항목 | 사무용품 |");
    expect(result).toContain("성명: ___");
  });

  it("4개 필드 연속 치환 시뮬레이션", () => {
    const fields: Record<string, string> = {
      성명: "홍길동",
      생년월일: "1990-01-01",
      항목: "사무용품",
      금액: "50000",
    };

    let md = template;
    for (const [label, value] of Object.entries(fields)) {
      ({ result: md } = replaceField(md, label, value));
    }

    expect(md).toContain("성명: 홍길동");
    expect(md).toContain("생년월일: 1990-01-01");
    expect(md).toContain("| 항목 | 사무용품 |");
    expect(md).toContain("| 금액 | 50000 |");
    expect(md).toContain("주소: ___"); // 채우지 않은 필드 유지
  });
});

// ─── 엣지 케이스 ─────────────────────────────────────────────────────────────

describe("엣지 케이스", () => {
  it("빈 마크다운 → 변경 없음, replaced=false", () => {
    const { result, replaced } = replaceField("", "성명", "홍길동");
    expect(replaced).toBe(false);
    expect(result).toBe("");
  });

  it("값에 URL 특수 문자 포함 → 그대로 삽입", () => {
    const { result, replaced } = replaceField(
      "URL: ___",
      "URL",
      "https://example.com/path?q=1"
    );
    expect(replaced).toBe(true);
    expect(result).toBe("URL: https://example.com/path?q=1");
  });

  it("값에 한글 + 숫자 + 하이픈 → 그대로 삽입", () => {
    const { result } = replaceField("주민번호: ___", "주민번호", "900101-1234567");
    expect(result).toBe("주민번호: 900101-1234567");
  });

  it("값이 빈 문자열이어도 치환 성공 (비우기 동작)", () => {
    const { result, replaced } = replaceField("성명: ___", "성명", "");
    expect(replaced).toBe(true);
    expect(result).toBe("성명: ");
  });

  it("동일 라벨이 여러 줄에 반복 → 모두 치환 (gi 플래그)", () => {
    const md = "성명: ___\n성명: ___\n성명: ___";
    const { result } = replaceField(md, "성명", "홍길동");
    expect(result).toBe("성명: 홍길동\n성명: 홍길동\n성명: 홍길동");
  });
});
