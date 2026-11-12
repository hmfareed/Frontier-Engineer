# Part 35: Graph Engine Architecture

## Overview

The Frontier Engineer Graph Engine provides a deterministic, queryable directed graph representing the structural relationships of a repository. It transforms scanner inventory and AST extractions into typed nodes and provenance-backed edges.

The graph answers fundamental engineering questions without requiring stochastic language models:

- What does a given module depend on?
- What other files depend on a given component?
- Which tests verify a given source module?
- Which imports remain unresolved?
- Are there circular dependency cycles?

## Node & Edge Taxonomy

### Deterministic Node Identities

Every node in the engineering graph has a deterministic identity scheme:

| Category     | Node Identity Format    | Description                  | Example                       |
| ------------ | ----------------------- | ---------------------------- | ----------------------------- |
| `repository` | `repo:<identity>`       | Root repository entity       | `repo:repo_8a92f0c1`          |
| `directory`  | `dir:<relative_path>`   | Directory hierarchy node     | `dir:src/components`          |
| `file`       | `file:<canonical_path>` | Source or asset file         | `file:src/index.ts`           |
| `symbol`     | `sym:<symbol_id>`       | Extracted AST symbol         | `sym:src/index.ts#App`        |
| `package`    | `pkg:<name>`            | External third-party package | `pkg:react`                   |
| `module`     | `mod:<specifier>`       | Unresolved module reference  | `mod:./missing`               |
| `test`       | `file:<canonical_path>` | Verified test suite file     | `file:tests/unit/app.test.ts` |
| `component`  | `comp:<name>`           | Architectural subsystem      | `comp:src/components`         |
| `adr`        | `adr:<id>`              | Architecture Decision Record | `adr:ADR-007`                 |

### Directed Edge Relationships

Every edge has a deterministic identity: `<source_identity>-><relationship>-><target_identity>`.

| Relationship Type | Source          | Target          | Meaning                                 |
| ----------------- | --------------- | --------------- | --------------------------------------- |
| `CONTAINS`        | `repo` / `dir`  | `dir` / `file`  | Filesystem containment                  |
| `DEFINES`         | `file` / `sym`  | `sym`           | Declaration of a symbol                 |
| `IMPORTS`         | `file`          | `file` / `mod`  | Module import statement                 |
| `EXPORTS`         | `file`          | `sym`           | Exported declaration                    |
| `DEPENDS_ON`      | `file` / `comp` | `pkg`           | External package dependency             |
| `TESTS`           | `test`          | `file`          | Test suite covering a source module     |
| `DOCUMENTS`       | `file` / `adr`  | `comp` / `file` | Architectural documentation             |
| `DECIDED_BY`      | `comp`          | `adr`           | ADR governing an architectural decision |

## Provenance and Confidence Model

Edges are categorized by confidence and observation status:

1. **`CONFIRMED` (Confidence: 0.90 – 1.0):** Directly grounded in syntactic AST evidence, file manifest declarations, or confirmed module resolution.
2. **`INFERRED` (Confidence: 0.50 – 0.89):** Established through directory conventions, naming similarities, or heuristic pattern matching.
3. **`UNRESOLVED` (Confidence: 0.0 – 0.49):** Module imports that failed resolution against any indexed file in the repository.

### Unresolved Imports

Rather than dropping or ignoring broken imports, the Graph Engine creates explicit `mod:<specifier>` nodes and connects them with `relationshipStatus: "UNRESOLVED"`. This exposes missing modules or broken configuration directly to analysis queries.

## Traversal Algorithms & Cycle Safety

Graph traversals (`getDependencies` and `getDependents`) use bounded Breadth-First Search (BFS):

- **Configurable Depth:** Default `maxDepth = 10`. Traversal stops when the bound is reached.
- **Path-Cycle Tracking:** Each traversal step maintains a path-visited set. When a cycle (e.g. $A \to B \to C \to A$) is encountered, `hasCycles` is set to `true` and the back-edge is recorded without entering an infinite loop.
- **Filtering:** Traversal can filter by specific relationship types (e.g. only `IMPORTS`) or target node categories (e.g. only `file`).

## Graph Validation

Before snapshot promotion, `GraphValidator` executes integrity checks:

1. Rejects duplicate node or edge identities.
2. Confirms that every edge references valid existing source and target nodes within the same scan.
3. Confirms confidence values are within the range $[0.0, 1.0]$.
4. Confirms composite foreign keys are not violated.
