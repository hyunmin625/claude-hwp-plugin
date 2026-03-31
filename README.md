# claude-hwp-plugin

> **Claude Code** 로 한컴 한글 문서(.hwp / .hwpx)를 자연어로 완전히 제어하는 AI 에이전트 플러그인

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org)
[![MCP](https://img.shields.io/badge/MCP-1.28-purple)](https://modelcontextprotocol.io)

---

## 개요

한국 공공기관·기업 표준 문서 포맷인 **HWP / HWPX** 를 AI 에이전트로 자동화합니다.

- **자연어 명령** 만으로 문서 읽기·양식 채우기·새 문서 생성·비교를 수행
- [kordoc](https://github.com/chrisryugj/kordoc) 라이브러리를 **MCP Server** 로 래핑, Claude Code **Skill** 과 연결
- `.hwp` / `.hwpx` / `.pdf` 읽기 지원, 쓰기는 `.hwpx` 포맷으로 출력

```
사용자 자연어 명령
      ↓
Claude Code + Skill (SKILL.md)
      ↓
MCP Server (index.ts — 8개 도구)
      ↓
kordoc 라이브러리 (HWP/HWPX 파싱·생성)
      ↓
출력 파일 (.hwpx) 또는 구조화 데이터
```

---

## 주요 기능

| 기능 | 자연어 명령 예시 |
|------|----------------|
| 📄 **문서 읽기** | "보고서.hwpx 내용 요약해줘" |
| ✏️ **양식 자동 채우기** | "신청서.hwp 양식에 이름 홍길동, 날짜 오늘로 채워줘" |
| 📋 **일괄 양식 생성** | "직원 명단 CSV로 신청서 100개 한 번에 만들어줘" |
| ✨ **새 문서 생성** | "월간 업무 보고서를 HWPX로 만들어줘" |
| 🔍 **문서 비교** | "v1.hwpx와 v2.hwpx 변경된 부분 알려줘" |
| 🏷️ **메타데이터 확인** | "이 문서 작성자랑 수정일 알려줘" |
| 🔎 **포맷 감지** | "이 파일이 진짜 HWP인지 확인해줘" |

---

## 제공 MCP 도구 (8개)

| 도구 | 설명 |
|------|------|
| `hwp_parse` | HWP / HWPX / PDF → 마크다운 + 구조화 블록(IRBlock[]) 변환 |
| `hwp_detect_format` | 파일 매직 바이트 분석으로 실제 포맷 감지 |
| `hwp_extract_form` | 양식(서식) 필드 추출 — 라벨, 현재값, 신뢰도 반환 |
| `hwp_fill_form` | 양식 템플릿에 데이터를 채워 HWPX 파일 생성 |
| `hwp_batch_fill` | 하나의 템플릿으로 여러 레코드를 일괄 처리 (최대 500건) |
| `hwp_create` | 마크다운 텍스트로 새 HWPX 문서 생성 |
| `hwp_compare` | 두 문서를 비교하여 추가 / 삭제 / 수정 블록 표시 |
| `hwp_metadata` | 제목·작성자·날짜·페이지 수 등 메타데이터 빠른 추출 |

---

## 프로젝트 구조

```
claude-hwp-plugin/
├── plugin.json                  # 플러그인 매니페스트 (MCP 서버 + Skill 등록)
├── plan.md                      # 개발 계획 및 로드맵
│
├── mcp-server/                  # MCP 백엔드 서버
│   ├── src/
│   │   ├── index.ts             # 8개 MCP 도구 구현 (메인)
│   │   └── __tests__/           # 단위 테스트 (vitest)
│   │       ├── utils.test.ts    # formatBytes, escapeRegex, 파일 검증 (41개)
│   │       ├── patterns.test.ts # 필드 치환 정규식 패턴 테스트 (29개)
│   │       └── batch.test.ts    # 배치 처리, Zod 스키마 검증 (40개)
│   ├── dist/                    # 빌드 결과물 (tsc 컴파일)
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
│
├── skills/
│   └── SKILL.md                 # Claude Code Skill 프롬프트
│
└── scripts/
    └── package-plugin.mjs       # .plugin 아카이브 패키징 스크립트
```

---

## 설치 및 사용

### 요구사항

- Node.js **18** 이상
- Claude Code (MCP 사용 가능 버전)

### 1. 의존성 설치 및 빌드

```bash
# 루트 의존성 설치 (패키징 도구 포함)
npm install

# MCP 서버 의존성 설치 및 TypeScript 빌드
cd mcp-server
npm install
npm run build
cd ..
```

### 2. Claude Code에 MCP 서버 등록

`~/.claude.json` 또는 Claude Code MCP 설정에 추가:

```json
{
  "mcpServers": {
    "claude-hwp": {
      "command": "node",
      "args": ["/절대경로/claude-hwp-plugin/mcp-server/dist/index.js"]
    }
  }
}
```

또는 Claude Code CLI 로 등록:

```bash
claude mcp add claude-hwp node /절대경로/claude-hwp-plugin/mcp-server/dist/index.js
```

### 3. Skill 등록 (선택)

`plugin.json` 에 정의된 Skill이 Claude Code에서 자동 인식됩니다.

---

## 사용 예시

### 양식 자동 채우기

```
나: "입사지원서.hwpx 양식에 이름 홍길동, 지원직무 개발자, 날짜 2026-03-31로 채워서 저장해줘"

Claude: hwp_extract_form 도구로 양식 필드를 확인합니다...
        - [이름] 현재값: (빈칸)
        - [지원직무] 현재값: (빈칸)
        - [날짜] 현재값: (빈칸)

        hwp_fill_form 도구로 채웁니다...
        ✅ 완료: ./output/입사지원서_filled.hwpx (24.1 KB)
        ✔ 채워진 필드: 이름, 지원직무, 날짜
```

### 일괄 양식 생성 (배치)

```
나: "직원명단.json 데이터로 재직증명서.hwpx 양식을 한 번에 생성해줘. 파일명은 이름으로 해줘"

Claude: hwp_batch_fill 도구로 50명분 재직증명서를 생성합니다...
        ✅ 50개 파일 생성 완료 → ./output/ 디렉토리
        ✔ 홍길동.hwpx, 김영희.hwpx, 이철수.hwpx ...
```

### 문서 비교

```
나: "계약서_v1.hwpx와 계약서_v2.hwpx 달라진 내용 알려줘"

Claude: hwp_compare 결과:
        📊 추가: 3개 블록 / 삭제: 1개 블록 / 수정: 5개 블록
        ➕ [추가] 제5조 손해배상 조항 신설
        ✏️  [수정] 계약 기간 1년 → 2년
        ...
```

---

## 개발

### 테스트 실행

```bash
cd mcp-server

# 전체 테스트 실행 (110개)
npm test

# 파일 변경 감지 모드
npm run test:watch

# 커버리지 리포트
npm run test:coverage
```

### .plugin 파일 패키징

```bash
# 루트 디렉토리에서
npm run package          # 빌드 + 패키징
npm run package:only     # 패키징만 (이미 빌드된 경우)

# 출력: claude-hwp-plugin-v0.1.0.plugin
claude plugin install ./claude-hwp-plugin-v0.1.0.plugin
```

### 기술 스택

| 분류 | 기술 |
|------|------|
| 런타임 | Node.js ≥ 18 |
| 언어 | TypeScript 5.5 |
| MCP 프로토콜 | @modelcontextprotocol/sdk 1.28 |
| 문서 엔진 | kordoc 1.6 |
| 스키마 검증 | Zod 3.23 |
| 테스트 | Vitest 2.x |
| 패키징 | archiver 7.x |

---

## 제한 사항

| 항목 | 제한 |
|------|------|
| 파일 크기 | 최대 500 MB |
| 배치 처리 | 최대 500건 |
| 쓰기 포맷 | HWPX 전용 (HWP 바이너리 쓰기 미지원) |
| 읽기 포맷 | HWP / HWPX / PDF |
| 필드 감지 | 비표준 양식은 신뢰도 저하 가능 |

---

## 개발 로드맵

- [x] **Phase 1** — kordoc 분석 + MCP Server 기반 구축 (8개 도구)
- [x] **Phase 2** — 양식 채우기 고도화 + 배치 처리 (`hwp_batch_fill`, 최대 500건)
- [x] **Phase 2** — 단위 테스트 110개 작성 (vitest)
- [x] **Phase 3** — `.plugin` 패키징 스크립트 완성
- [ ] **Phase 3** — Claude Code 마켓플레이스 배포

---

## 참조

- [kordoc](https://github.com/chrisryugj/kordoc) — HWP / HWPX / PDF 파싱·생성 엔진
- [Model Context Protocol](https://modelcontextprotocol.io) — MCP 사양
- [Claude Code Docs](https://docs.claude.com) — Claude Code 문서

---

## 라이선스

[MIT](LICENSE) © 2026 hyunmin625
