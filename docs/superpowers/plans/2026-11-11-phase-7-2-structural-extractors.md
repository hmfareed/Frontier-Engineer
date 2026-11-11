# Frontier Engineer — Phase 7.2: Structural Extractors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 7.2 Structural Extractors for Frontier Engineer: bundled zero-dependency TypeScript parser runtime, standard TypeScript module resolution, line-independent deterministic symbol identity and token fingerprinting, AST visitor distinguishing declarations from initializers, and source evidence extraction.

**Architecture:** A modular, storage-independent extraction pipeline residing under `scripts/extractor/`. A self-contained parser loader executes the TypeScript AST parser without runtime `node_modules` dependencies (`dist/parser.bundle.js`). A module resolver resolves import/re-export specifiers against `tsconfig.json` paths and workspace files. An AST visitor traverses source files, extracts symbols, imports, re-exports, and JSX components. A symbol identity engine generates line-independent, deterministic symbol IDs and AST token fingerprints.

**Tech Stack:** TypeScript 5.9, Node.js >=22.6.0, Node.js crypto (SHA-256), Vite/esbuild for parser bundling, Vitest for unit and integration testing.

**Spec:** Phase 7.0.2 Architecture Specification (Sections 3, 7, 8, 15, and 16).

---

## Global Constraints

- Frontier Engineer version remains strictly `0.6.3` during Phase 7.2.
- Phase 1–6 runtime components (6 agents, 10 skills, 14 rules, 5 MCP servers, 6 hooks) must remain completely untouched.
- The two Phase 6 host-level limitations must remain documented accurately:
  1. PostgreSQL host-level MCP interception is **NOT VERIFIED**.
  2. Interactive `force_ask` permission cache bypass is **BLOCKED**.
- Zero database dependencies: Phase 7.2 operates strictly in-memory and must not import SQLite or database persistence modules.
- Zero runtime `node_modules` dependency: The parser runtime must function in isolated environments without `node_modules`.
- Line-independent symbol stability: Blank lines or whitespace formatting must not alter `symbol_id` or `fingerprint`.

---

## Review Focus

The five edge cases and failure modes most critical to engineering memory integrity:

1. **Parser Execution in Isolated Environment:** When run in an environment with no `node_modules/` and wiped `NODE_PATH`, AST extraction must succeed without throwing `MODULE_NOT_FOUND` (`AC-7201`).
2. **Declaration vs. Initializer Disambiguation:** `const foo = () => {}` must be extracted as a `variable` declaration with `inferredCallable: true`, not an isolated `function` declaration node.
3. **Line-Number Volatility:** Inserting blank lines or modifying comments at line 1 must leave `symbol_id` and `fingerprint` completely unchanged (`AC-7202`).
4. **Re-Export Graph Edges:** `export { x } from "./mod"` must create a direct re-export edge to `./mod` and must not register `x` as a locally declared symbol.
5. **Path Aliasing and Directory Probing:** Relative imports without extensions (`./util`), directory index imports (`./components` -> `./components/index.ts`), and path aliases (`@/types` -> `src/types/index.ts`) must resolve deterministically, while external packages must be flagged as `unresolved`.

---

## Task Structure

### Task 1: Extraction Types and Contracts

**Files:**

- Create: `scripts/extractor/types.ts`
- Test: `tests/unit/extractor-types.test.ts`

**Interfaces:**

- Produces: `ExtractedSymbol`, `ImportRecord`, `ExportRecord`, `SourceEvidence`, `ExtractionResult`, `ExtractorOptions`, `ExtractionStatus`.

- [ ] **Step 1: Write the failing test for type contracts and invariants**
      Create `tests/unit/extractor-types.test.ts` asserting required fields on mock `ExtractionResult`, `ExtractedSymbol`, and evidence invariants.
- [ ] **Step 2: Run test to verify it fails**
      Run `npx vitest run tests/unit/extractor-types.test.ts` -> FAIL (`Cannot find module scripts/extractor/types.ts`).
- [ ] **Step 3: Implement data types in `scripts/extractor/types.ts`**
      Define `ExtractedSymbol`, `ImportRecord`, `ExportRecord`, `SourceEvidence`, `ExtractionResult`, and diagnostic interfaces.
- [ ] **Step 4: Run test to verify it passes**
      Run `npx vitest run tests/unit/extractor-types.test.ts` -> PASS.
- [ ] **Step 5: Commit**
      `git add scripts/extractor/types.ts tests/unit/extractor-types.test.ts && git commit -m "feat(extractor): define structural extraction types and contracts"`

---

### Task 2: Self-Contained Parser Bundle & Loader

**Files:**

- Create: `scripts/extractor/parser-loader.ts`
- Create: `scripts/build-parser-bundle.ts`
- Generate: `dist/parser.bundle.js`
- Test: `tests/unit/extractor-parser-bundle.test.ts`
- Test: `tests/unit/extractor-isolated-runtime.test.ts`

**Interfaces:**

- Produces: `loadParser(): Promise<ParserApi>` where `ParserApi` exposes `createSourceFile`, `forEachChild`, `SyntaxKind`, `ScriptTarget`.

- [ ] **Step 1: Write the failing test for parser loading and isolated subprocess execution**
      Create `tests/unit/extractor-isolated-runtime.test.ts` spawning a Node process with empty `NODE_PATH` and isolated cwd, verifying `loadParser()` parses a sample TypeScript snippet.
- [ ] **Step 2: Run test to verify it fails**
      Run `npx vitest run tests/unit/extractor-isolated-runtime.test.ts` -> FAIL.
- [ ] **Step 3: Implement `scripts/build-parser-bundle.ts` and `scripts/extractor/parser-loader.ts`**
      Bundle minimal TypeScript parser routines via Vite/esbuild into `dist/parser.bundle.js`. Implement `parser-loader.ts` to load bundled parser with graceful development fallback.
- [ ] **Step 4: Execute parser build script and verify tests pass**
      Run build command and `npx vitest run tests/unit/extractor-isolated-runtime.test.ts` -> PASS (`AC-7201`).
- [ ] **Step 5: Commit**
      `git add scripts/build-parser-bundle.ts scripts/extractor/parser-loader.ts dist/parser.bundle.js tests/unit/extractor-*.test.ts && git commit -m "feat(extractor): package self-contained TypeScript parser bundle"`

---

### Task 3: Deterministic Symbol Identity & AST Token Fingerprinting

**Files:**

- Create: `scripts/extractor/symbol-identity.ts`
- Test: `tests/unit/extractor-symbol-identity.test.ts`

**Interfaces:**

- Consumes: `ParserApi` from `parser-loader.ts`.
- Produces:
  - `computeSymbolId(canonicalPath, parentScope, kind, qualifiedName, disambiguator): string`
  - `computeFingerprint(node, sourceFile): string`

- [ ] **Step 1: Write the failing test for symbol stability and line-independence**
      Create `tests/unit/extractor-symbol-identity.test.ts` verifying:
  - Inserting 10 blank lines leaves `symbol_id` and `fingerprint` unchanged (`AC-7202`).
  - Whitespace and comment changes leave `fingerprint` unchanged.
  - Renaming or changing declaration kind changes `symbol_id`.
  - Overload signatures receive distinct disambiguators (`@overload:1`, `@overload:2`, `@impl`).
- [ ] **Step 2: Run test to verify it fails**
      Run `npx vitest run tests/unit/extractor-symbol-identity.test.ts` -> FAIL.
- [ ] **Step 3: Implement `computeSymbolId` and `computeFingerprint` in `scripts/extractor/symbol-identity.ts`**
      Implement SHA-256 canonical identity formula and AST token normalization algorithm.
- [ ] **Step 4: Run test to verify it passes**
      Run `npx vitest run tests/unit/extractor-symbol-identity.test.ts` -> PASS.
- [ ] **Step 5: Commit**
      `git add scripts/extractor/symbol-identity.ts tests/unit/extractor-symbol-identity.test.ts && git commit -m "feat(extractor): implement line-independent symbol identity and token fingerprinting"`

---

### Task 4: TypeScript Module Resolution Engine

**Files:**

- Create: `scripts/extractor/module-resolver.ts`
- Test: `tests/unit/extractor-module-resolution.test.ts`

**Interfaces:**

- Produces: `resolveModuleSpecifier(specifier, fromCanonicalPath, workspaceRoot, tsconfig?): ModuleResolutionResult`.

- [ ] **Step 1: Write the failing test for module resolution**
      Create `tests/unit/extractor-module-resolution.test.ts` testing:
  - Relative file extension probing (`.ts`, `.tsx`, `.d.ts`, `.js`, `.jsx`).
  - Directory index probing (`./components` -> `./components/index.ts`).
  - `tsconfig.json` path aliasing (`@/*` -> `src/*`).
  - `package.json` `"exports"` and `"main"`.
  - External and Node built-in packages classified as `unresolved`.
- [ ] **Step 2: Run test to verify it fails**
      Run `npx vitest run tests/unit/extractor-module-resolution.test.ts` -> FAIL.
- [ ] **Step 3: Implement `module-resolver.ts`**
      Implement standard TypeScript resolution probe sequence without spawning compiler processes.
- [ ] **Step 4: Run test to verify it passes**
      Run `npx vitest run tests/unit/extractor-module-resolution.test.ts` -> PASS.
- [ ] **Step 5: Commit**
      `git add scripts/extractor/module-resolver.ts tests/unit/extractor-module-resolution.test.ts && git commit -m "feat(extractor): implement TypeScript module and import resolver"`

---

### Task 5: AST Visitor & Declarations vs. Initializers

**Files:**

- Create: `scripts/extractor/ast-visitor.ts`
- Test: `tests/unit/extractor-ast-visitor.test.ts`

**Interfaces:**

- Consumes: `parser-loader.ts`, `symbol-identity.ts`, `types.ts`.
- Produces: `visitSourceFile(sourceFile, canonicalPath): FileAstFindings`.

- [ ] **Step 1: Write the failing test for AST node classification**
      Create `tests/unit/extractor-ast-visitor.test.ts` asserting:
  - Functions vs Arrow variables (`const bar = () => {}` -> variable with `inferredCallable: true`).
  - Classes, interfaces, types, enums, methods.
  - Re-exports (`export { a } from "./mod"`) emitting re-export record with no local symbol.
  - Dynamic imports (`import("./mod")`) marked `status: 'inferred'`.
  - React component heuristic (PascalCase returning JSX element -> confidence 0.8; `React.FC` -> 1.0).
- [ ] **Step 2: Run test to verify it fails**
      Run `npx vitest run tests/unit/extractor-ast-visitor.test.ts` -> FAIL.
- [ ] **Step 3: Implement `ast-visitor.ts`**
      Implement recursive descent visitor distinguishing declarations, initializers, imports, exports, and call expressions.
- [ ] **Step 4: Run test to verify it passes**
      Run `npx vitest run tests/unit/extractor-ast-visitor.test.ts` -> PASS.
- [ ] **Step 5: Commit**
      `git add scripts/extractor/ast-visitor.ts tests/unit/extractor-ast-visitor.test.ts && git commit -m "feat(extractor): implement AST visitor and node classification"`

---

### Task 6: Public Extractor Facade & Comprehensive Integration

**Files:**

- Create: `scripts/extractor/index.ts`
- Test: `tests/unit/extractor-orchestrator.test.ts`

**Interfaces:**

- Produces: `extractFileSymbols(canonicalPath, content, options?): Promise<ExtractionResult>`.

- [ ] **Step 1: Write the failing test for end-to-end structural extraction**
      Create `tests/unit/extractor-orchestrator.test.ts` verifying full pipeline on representative TypeScript files.
- [ ] **Step 2: Run test to verify it fails**
      Run `npx vitest run tests/unit/extractor-orchestrator.test.ts` -> FAIL.
- [ ] **Step 3: Implement `scripts/extractor/index.ts`**
      Integrate parser loading, AST visiting, module resolution, and symbol identity into clean public facade.
- [ ] **Step 4: Run test to verify it passes**
      Run `npx vitest run tests/unit/extractor-orchestrator.test.ts` -> PASS.
- [ ] **Step 5: Commit**
      `git add scripts/extractor/index.ts tests/unit/extractor-orchestrator.test.ts && git commit -m "feat(extractor): provide public structural extraction facade"`

---

### Task 7: Full Regression & Phase 7.2 Verification

- [ ] **Step 1: Run TypeScript typecheck**
      `npm run typecheck`
- [ ] **Step 2: Run foundation validation**
      `npm run validate`
- [ ] **Step 3: Run full Vitest suite**
      `npm test`
- [ ] **Step 4: Run Prettier formatting check**
      `npm run format:check`
- [ ] **Step 5: Run Markdown linting**
      `npm run lint:md`
- [ ] **Step 6: Run strict Antigravity CLI plugin validation**
      `& "$HOME\.gemini\bin\agy.exe" plugin validate --strict .`
- [ ] **Step 7: Verify version remains 0.6.3 and Phase 1–6 files are untouched**
      `git status` and `git diff` check.
