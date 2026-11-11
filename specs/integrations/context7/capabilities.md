# Context7 Integration Capabilities

This document specifies the exact tools, parameters, and invocation contracts for `@upstash/context7-mcp`.

## Permission Class Summary

| Tool Name            | Permission Class | Target Scope                 | Human Confirmation Required | Agent Affinity                                                                  |
| :------------------- | :--------------- | :--------------------------- | :-------------------------- | :------------------------------------------------------------------------------ |
| `resolve-library-id` | Read-only        | Public documentation catalog | No                          | `frontier-engineer`, `architect`, `implementation-engineer`, `security-auditor` |
| `query-docs`         | Read-only        | Library documentation index  | No                          | `frontier-engineer`, `architect`, `implementation-engineer`, `security-auditor` |

## Tool Specifications

### `resolve-library-id`

- **Description:** Discovers authoritative Context7 library identifiers matching a package or framework name.
- **Parameters:**
  - `query` (string, required): General library name, framework, or package (e.g., `next.js`, `tailwind`, `zod`, `fastapi`).
- **Output:** Array of matching library records, including:
  - Canonical library ID (formatted as `/org/project`, e.g., `/vercel/next.js`).
  - Available versions and release tags.
  - Community trust score and code snippet counts.
  - Brief project description.

### `query-docs`

- **Description:** Retrieves targeted, version-filtered documentation snippets and code examples for a resolved library.
- **Parameters:**
  - `libraryId` (string, required): Resolved library ID (e.g., `/vercel/next.js`, `/colinhacks/zod`).
  - `query` (string, required): Specific technical question, method, or concept (e.g., `Server Actions error handling`, `z.discriminatedUnion`).
- **Output:** Clean markdown excerpts containing verified API signatures, parameter documentation, and idiomatic code snippets.
