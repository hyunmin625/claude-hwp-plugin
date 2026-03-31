#!/usr/bin/env node
/**
 * scripts/package-plugin.mjs
 *
 * claude-hwp-plugin 을 배포용 .plugin (ZIP) 파일로 패키징합니다.
 *
 * 사용법:
 *   node scripts/package-plugin.mjs           # 루트에서 직접 실행
 *   npm run package                            # 루트 package.json 스크립트 (빌드 포함)
 *   npm run package:only                       # 빌드 생략, 패키징만
 *
 * 출력:
 *   ./claude-hwp-plugin-v{version}.plugin
 *
 * .plugin 아카이브 구조:
 *   plugin.json               ← 플러그인 매니페스트
 *   skills/
 *     SKILL.md                ← Claude Code Skill 프롬프트
 *   mcp-server/
 *     dist/
 *       index.js              ← 컴파일된 MCP 서버
 *     package.json            ← 의존성 정의 (설치 시 필요)
 */

import { createWriteStream, existsSync } from "fs";
import { readFile, stat, readdir } from "fs/promises";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─── archiver는 CommonJS 패키지 → createRequire로 로드 ───────────────────────
const require = createRequire(import.meta.url);

// ─── archiver 유무 확인 ────────────────────────────────────────────────────────
let archiver;
try {
  archiver = require("archiver");
} catch {
  console.error("❌ archiver 패키지가 없습니다.");
  console.error("   루트 디렉토리에서 다음 명령을 실행하세요:");
  console.error("   > npm install\n");
  process.exit(1);
}

// ─── 플러그인 정보 읽기 ───────────────────────────────────────────────────────
const pluginJsonPath = join(ROOT, "plugin.json");
if (!existsSync(pluginJsonPath)) {
  console.error("❌ plugin.json 을 찾을 수 없습니다:", pluginJsonPath);
  process.exit(1);
}

const pluginJson = JSON.parse(await readFile(pluginJsonPath, "utf-8"));
const { name, version } = pluginJson;

console.log(`\n📦 ${name} v${version} 패키징 시작...\n`);

// ─── 빌드 결과물 존재 확인 ───────────────────────────────────────────────────
const requiredFiles = [
  { path: join(ROOT, "mcp-server", "dist", "index.js"), label: "MCP 서버 빌드" },
  { path: join(ROOT, "skills", "SKILL.md"),              label: "Skill 프롬프트" },
  { path: join(ROOT, "plugin.json"),                     label: "플러그인 매니페스트" },
  { path: join(ROOT, "mcp-server", "package.json"),      label: "MCP 서버 의존성" },
];

let hasError = false;
for (const { path, label } of requiredFiles) {
  if (!existsSync(path)) {
    console.error(`❌ 누락: [${label}]  ${path}`);
    hasError = true;
  } else {
    const { size } = await stat(path);
    const kb = (size / 1024).toFixed(1);
    console.log(`  ✔ [${label}]  ${relative(ROOT, path)}  (${kb} KB)`);
  }
}

if (hasError) {
  console.error("\n빌드 결과물이 없으면 먼저 빌드를 실행하세요:");
  console.error("  > cd mcp-server && npm run build\n");
  process.exit(1);
}

// dist/ 디렉토리 내 전체 파일 목록 출력
const distDir = join(ROOT, "mcp-server", "dist");
const distFiles = await readdir(distDir, { recursive: true });
console.log(`\n  📂 mcp-server/dist/ (${distFiles.length}개 파일)`);
for (const f of distFiles) {
  console.log(`     - ${f}`);
}

// ─── ZIP 아카이브 생성 ────────────────────────────────────────────────────────
const outputName = `${name}-v${version}.plugin`;
const outputPath = join(ROOT, outputName);

// 기존 파일 경고
if (existsSync(outputPath)) {
  console.log(`\n⚠️  기존 파일을 덮어씁니다: ${outputName}`);
}

const output = createWriteStream(outputPath);
const archive = archiver("zip", { zlib: { level: 9 } });

// ─── 이벤트 핸들러 ────────────────────────────────────────────────────────────
output.on("close", () => {
  const sizeKb = (archive.pointer() / 1024).toFixed(1);
  const sizeMb = (archive.pointer() / (1024 * 1024)).toFixed(2);

  console.log("\n─────────────────────────────────────────");
  console.log("✅ 패키징 완료!");
  console.log(`📁 출력 파일 : ${outputPath}`);
  console.log(`📊 크기      : ${sizeKb} KB (${sizeMb} MB, ${archive.pointer().toLocaleString()} bytes)`);
  console.log("\n📋 아카이브 구조:");
  console.log("   plugin.json");
  console.log("   skills/SKILL.md");
  console.log("   mcp-server/dist/index.js");
  console.log("   mcp-server/dist/*.d.ts  (타입 선언)");
  console.log("   mcp-server/package.json");
  console.log("\n🚀 Claude Code 설치 방법:");
  console.log(`   claude plugin install ./${outputName}`);
  console.log("─────────────────────────────────────────\n");
});

archive.on("warning", (err) => {
  if (err.code === "ENOENT") {
    console.warn("⚠️  파일 없음 경고:", err.message);
  } else {
    throw err;
  }
});

archive.on("error", (err) => {
  console.error("❌ 패키징 오류:", err.message);
  throw err;
});

archive.on("entry", (entry) => {
  process.stdout.write(`  → ${entry.name}\n`);
});

console.log("\n📥 아카이브에 추가 중...");
archive.pipe(output);

// ─── 파일 추가 ────────────────────────────────────────────────────────────────

// 1. plugin.json (루트)
archive.file(join(ROOT, "plugin.json"), { name: "plugin.json" });

// 2. skills/ 디렉토리 전체
archive.directory(join(ROOT, "skills"), "skills");

// 3. mcp-server/dist/ (컴파일된 JS + 타입 선언) — 테스트 빌드 제외
archive.directory(join(ROOT, "mcp-server", "dist"), "mcp-server/dist", (entry) => {
  // dist/__tests__/ 는 배포에 불필요 — 제외
  if (entry.name.startsWith("mcp-server/dist/__tests__/")) return false;
  return entry;
});

// 4. mcp-server/package.json (플러그인 설치 시 npm install 에 필요)
archive.file(join(ROOT, "mcp-server", "package.json"), {
  name: "mcp-server/package.json",
});

// 최종화
await archive.finalize();
