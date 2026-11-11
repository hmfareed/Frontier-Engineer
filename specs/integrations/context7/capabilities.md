# Context7 Integration Capabilities

This document specifies the tools, parameters, and invocation contracts for the Context7 documentation integration.

## Permission Class Summary

| Tool Name                | Permission Class | Target Scope                | Human Confirmation Required | Agent Affinity                                                                  |
| :----------------------- | :--------------- | :-------------------------- | :-------------------------- | :------------------------------------------------------------------------------ |
| `search_docs`            | Read-only        | Public documentation index  | No                          | `frontier-engineer`, `architect`, `implementation-engineer`, `security-auditor` |
| `get_library_version`    | Read-only        | Package registry metadata   | No                          | `frontier-engineer`, `architect`, `implementation-engineer`                     |
| `fetch_api_signature`    | Read-only        | Type and symbol index       | No                          | `frontier-engineer`, `implementation-engineer`                                  |
| `retrieve_code_examples` | Read-only        | Documentation code snippets | No                          | `frontier-engineer`, `implementation-engineer`                                  |

## Tool Specifications

### `search_docs`

- **Description:** Queries official documentation for a library, framework, or cloud SDK.
- **Parameters:**
  - `library` (string, required): Package or framework name (e.g., `react`, `fastapi`, `vitest`, `zod`).
  - `query` (string, required): Conceptual topic, feature, or function name.
  - `limit` (integer, optional): Maximum sections to return (default: 5, max: 20).
- **Output:** Array of markdown sections containing documentation excerpts with source URLs.

### `get_library_version`

- **Description:** Resolves latest stable releases, breaking changes between versions, and deprecations.
- **Parameters:**
  - `library` (string, required): Package name.
  - `target_version` (string, optional): Specific version to inspect.
- **Output:** Version metadata, release date, and migration summary.

### `fetch_api_signature`

- **Description:** Retrieves exact function signature, parameters, return types, and interface contracts.
- **Parameters:**
  - `library` (string, required): Library name.
  - `symbol` (string, required): Class, function, method, or type identifier (e.g., `createSlice`, `z.object`).
- **Output:** TypeScript/Python type signatures and docstrings.

### `retrieve_code_examples`

- **Description:** Fetches official examples and verified recipes illustrating idiomatic usage.
- **Parameters:**
  - `library` (string, required): Library name.
  - `topic` (string, required): Feature or pattern (e.g., `optimistic-updates`, `custom-middleware`).
- **Output:** Verified code snippets annotated with explanation and prerequisites.
