# Part 36: Architecture Intelligence

## Overview

Frontier Engineer Architecture Intelligence transforms structural repository data into architectural insights. It identifies entrypoints, subsystem boundaries, dependency topologies, and test coverage associations using deterministic rules and verified repository evidence.

### Non-Negotiable Constraint: Zero AI Summaries

Architecture Intelligence does **not** employ stochastic LLM text generation, vector embeddings, or probabilistic summaries. All findings are deterministic: given the same repository files and scan configuration, the engine produces identical, reproducible results with explicit evidence traces.

## Capabilities

### 1. Entrypoint Detection

The engine scans project manifests and framework configuration to identify active entrypoints:

- **Manifest Declarations (`package.json`):** `main`, `module`, `bin`, and `scripts.start` entries.
- **Framework Routing Conventions:** Next.js (`app/page.tsx`, `pages/_app.tsx`), Vite (`index.html` $\to$ `src/main.tsx`), and Python WSGI/ASGI (`manage.py`, `wsgi.py`).
- **Standard Library Roots:** `src/index.ts` with verified exported symbols.

Every entrypoint record includes a type (`cli`, `server`, `browser`, `library`), confidence score, and detection evidence.

### 2. Component Boundary Detection

Directories are classified into architectural categories based on source code and import evidence:

| Category     | Typical Directory Roots                | Required Evidence for `CONFIRMED` Status                     |
| ------------ | -------------------------------------- | ------------------------------------------------------------ |
| `frontend`   | `src/components`, `src/pages`, `ui`    | JSX/TSX AST nodes, React/Vue/Svelte imports                  |
| `backend`    | `src/api`, `src/server`, `controllers` | HTTP server framework imports (`express`, `fastify`, `http`) |
| `database`   | `src/db`, `schema`, `migrations`       | SQL migration files, Prisma schema, or DB driver imports     |
| `auth`       | `src/auth`, `security`                 | Authentication/crypto libraries (`jsonwebtoken`, `bcrypt`)   |
| `shared_lib` | `packages/*`, `src/lib`, `common`      | Monorepo package boundaries or multi-component fan-in        |
| `test`       | `tests`, `test`, `__tests__`           | Verified test files (`.test.ts`, `.spec.ts`)                 |
| `docs`       | `docs`, `documentation`                | Markdown documentation or Architecture Decision Records      |

#### Conservative Classification Principle

A directory named `backend` that contains only utility functions and no server imports is classified as `status: "INFERRED"` with lower confidence ($< 0.70$), not as a confirmed backend service.

### 3. Dependency Architecture & Circular Dependency Detection

The dependency analyzer inspects all resolved internal imports to evaluate system health:

- **Circular Dependencies:** Employs Depth-First Search (DFS) cycle detection across file-to-file import edges to pinpoint exact import loops (e.g., $A \to B \to A$).
- **High Fan-out Modules:** Flags modules importing 5+ internal modules as candidates for refactoring or architectural decoupling.
- **External Dependencies:** Compiles an inventory of third-party packages actively imported by repository code.
- **Unresolved Imports:** Reports missing module specifiers to highlight configuration or typing issues.

### 4. Test Association Engine

Maps test files to the specific source modules they exercise:

1. **`CONFIRMED` Association:** The test file directly imports the source module or an exported symbol from that module (`confidence = 1.0`).
2. **`INFERRED` Association:** The test file follows a strict naming convention (e.g. `tests/unit/Button.test.ts` matching `src/Button.ts`) in the absence of a direct import (`confidence = 0.8`).

## Output Contract & Finding Schema

Every architectural finding adheres to the structured contract defined in Section 10 of the Phase 7.3 Directive:

```ts
interface ArchitectureFinding {
  findingId: string;
  repositoryId: number;
  scanId: number;
  category: "entrypoint" | "component" | "circular_dependency" | "test_association";
  subjectEntity: string;
  status: "CONFIRMED" | "INFERRED" | "CANDIDATE" | "UNRESOLVED";
  confidence: number; // 0.0 to 1.0
  detectionMethod: string;
  evidenceDescription: string;
  relevantFilePaths: string[];
  relevantLineRanges?: [number, number][];
}
```
