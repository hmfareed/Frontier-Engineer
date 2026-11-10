# Part 16 — Rule specifications

## Overview

Frontier Engineer defines fourteen engineering rules: one global foundation rule and thirteen modular rules across seven engineering categories. Every modular rule is defined by a canonical specification validated against `schemas/canonical-rule.schema.json`.

## Rule catalog summary

| Rule ID                 | Category    | Trigger Type     | Match Pattern / Condition                        | Priority | Enforcement |
| :---------------------- | :---------- | :--------------- | :----------------------------------------------- | :------- | :---------- |
| `AGENTS.md`             | foundation  | `always_on`      | Universal across all operations                  | 10       | Mandatory   |
| `general-engineering`   | engineering | `glob`           | `**/*.{ts,tsx,js,jsx,py,go,java,rs,c,cpp,cs}`    | 8        | Mandatory   |
| `code-quality`          | engineering | `glob`           | `**/*.{ts,tsx,js,jsx,py,go,java,rs,c,cpp,cs}`    | 8        | Mandatory   |
| `documentation`         | engineering | `glob`           | `**/*.{md,mdx},docs/**`                          | 6        | Mandatory   |
| `frontend-standards`    | frontend    | `glob`           | `**/*.{tsx,jsx,vue,svelte,css,scss,html}`        | 7        | Mandatory   |
| `accessibility`         | frontend    | `glob`           | `**/*.{tsx,jsx,vue,svelte,html}`                 | 8        | Mandatory   |
| `backend-standards`     | backend     | `glob`           | `**/*.{ts,js,py,go,java,rs,rb,php}`              | 7        | Mandatory   |
| `api-security`          | backend     | `model_decision` | API endpoints, auth, access controls             | 9        | Mandatory   |
| `database-standards`    | database    | `glob`           | `**/*.{sql,prisma,schema,db}`                    | 7        | Mandatory   |
| `migration-safety`      | database    | `glob`           | `**/migrations/**,**/*.sql`                      | 9        | Mandatory   |
| `security-standards`    | security    | `model_decision` | Security reviews, cryptography, OWASP            | 9        | Mandatory   |
| `secrets-management`    | security    | `glob`           | `**/*.{env*,json,yaml,yml,conf,config,ini,toml}` | 10       | Mandatory   |
| `testing-standards`     | testing     | `glob`           | `**/*.{test,spec}.{ts,tsx,js,jsx,py},tests/**`   | 8        | Mandatory   |
| `performance-standards` | performance | `model_decision` | Latency, profiling, memory, scaling              | 7        | Advisory    |

---

## Detailed specifications

### 1. Global foundation (`rules/AGENTS.md`)

- **Category:** `foundation`
- **Trigger:** Always on (no frontmatter)
- **Mandates:**
  - 15 core principles: inspect before editing, understand architecture, preserve project conventions, plan complex changes, make focused modifications, verify before asserting completion, run relevant tests, report test states honestly, avoid unnecessary dependencies, never expose secrets, require approval for destructive actions, preserve user work, distinguish assumptions from verified facts, avoid fabricating capabilities, document important decisions.
  - Strict verification discipline (6 canonical test states).
  - Scope discipline and human confirmation protocol for high-risk actions.

### 2. General engineering (`general-engineering`)

- **Category:** `engineering`
- **Trigger:** Glob (`**/*.{ts,tsx,js,jsx,py,go,java,rs,c,cpp,cs}`)
- **Mandates:** Respect existing repository architecture; match established naming conventions; preserve separation of concerns; enforce explicit type safety; propagate errors cleanly.
- **Prohibitions:** Speculative rewrites; unapproved external dependencies; circular layering; dead or commented-out code.

### 3. Code quality (`code-quality`)

- **Category:** `engineering`
- **Trigger:** Glob (`**/*.{ts,tsx,js,jsx,py,go,java,rs,c,cpp,cs}`)
- **Mandates:** Keep functions focused on single responsibility; prefer readability over cleverness; eliminate hidden side effects; validate external inputs; handle edge cases explicitly.
- **Prohibitions:** Copy-paste duplication across modules; premature or speculative abstraction; deep nested conditionals (> 3 levels); silent exception swallowing.

### 4. Documentation standards (`documentation`)

- **Category:** `engineering`
- **Trigger:** Glob (`**/*.{md,mdx},docs/**`)
- **Mandates:** Document public interfaces and types; record significant architectural decisions (ADRs); keep setup instructions synchronized with codebase; provide runnable verification commands.
- **Prohibitions:** Documenting unimplemented features as completed; conflicting setup instructions; fabricated API parameters or return types.

### 5. Frontend standards (`frontend-standards`)

- **Category:** `frontend`
- **Trigger:** Glob (`**/*.{tsx,jsx,vue,svelte,css,scss,html}`)
- **Mandates:** Component isolation and single responsibility; state locality; full coverage of asynchronous states (idle, loading, error, empty, success); semantic HTML and responsive layouts; client-side sanitization.
- **Prohibitions:** Committing secrets to client bundles; layout thrashing causing Cumulative Layout Shift (CLS); unresponsive spinner hangs on network errors; unstyled div soup replacing native interactive elements.

### 6. Accessibility standards (`accessibility`)

- **Category:** `frontend`
- **Trigger:** Glob (`**/*.{tsx,jsx,vue,svelte,html}`)
- **Mandates:** WCAG 2.1 Level AA compliance; full keyboard operability; visible high-contrast focus rings; accessible names and form labels; color contrast >= 4.5:1; reduced motion support.
- **Prohibitions:** Trapping focus in non-modal containers; icon-only buttons without accessible names; invalid ARIA roles; autoplaying sound or flashing content.

### 7. Backend engineering standards (`backend-standards`)

- **Category:** `backend`
- **Trigger:** Glob (`**/*.{ts,js,py,go,java,rs,rb,php}`)
- **Mandates:** Layered boundary isolation (transport, use case, domain, infrastructure); fail-fast request validation at perimeter; transactional state mutations; structured error mapping; contextual logging with correlation IDs.
- **Prohibitions:** Unvalidated database query strings; business logic embedded in transport controllers; unbounded in-memory buffering.

### 8. API security standards (`api-security`)

- **Category:** `backend`
- **Trigger:** Model decision (API security, auth, access controls)
- **Mandates:** Mandatory perimeter authentication; granular domain authorization (RBAC/ABAC preventing IDOR); rate limiting by IP/user; TLS 1.2+ with security headers; data filtering and PII masking.
- **Prohibitions:** Client-side only security checks; wildcard CORS with credentials; logging plaintext passwords or authorization headers; unbounded tokens without expiration.

### 9. Database standards (`database-standards`)

- **Category:** `database`
- **Trigger:** Glob (`**/*.{sql,prisma,schema,db}`)
- **Mandates:** Explicit foreign key and domain constraints; strategic indexes matching query filters; N+1 query elimination via eager loading; explicit column projections (`SELECT id, name`); connection pool sizing and timeout tuning.
- **Prohibitions:** Missing foreign key indexes causing full table scans; storing relational data as unstructured blobs; unindexed wildcards on large tables.

### 10. Migration safety standards (`migration-safety`)

- **Category:** `database`
- **Trigger:** Glob (`**/migrations/**,**/*.sql`)
- **Mandates:** Expand-and-contract pattern for schema evolution; lock minimization (concurrent index creation, short lock timeouts); idempotent and transactional DDL; verified rollback scripts.
- **Prohibitions:** Dropping columns/tables in the same release as code changes; adding non-nullable columns without defaults; renaming columns in active production tables.

### 11. Application security standards (`security-standards`)

- **Category:** `security`
- **Trigger:** Model decision (Security audits, OWASP, cryptography)
- **Mandates:** Defense-in-depth across all layers; parameterized database queries; context-aware output encoding; modern cryptographic primitives (Argon2id, AES-256-GCM); principle of least privilege.
- **Prohibitions:** Custom or deprecated cryptographic algorithms; plaintext credential storage; executing unsanitized user inputs in shell/eval interpreters; unpatched vulnerable dependencies.

### 12. Secrets management standards (`secrets-management`)

- **Category:** `security`
- **Trigger:** Glob (`**/*.{env*,json,yaml,yml,conf,config,ini,toml}`)
- **Mandates:** Externalized secrets injected via environment or secret managers; sanitized `.env.example` templates; comprehensive `.gitignore` protection; automated log redaction; immediate key revocation upon accidental exposure.
- **Prohibitions:** Hardcoding credentials in source code; sharing real secrets in PRs or issue comments; bypassing secret detection hooks; storing production credentials in test suites.

### 13. Testing and verification standards (`testing-standards`)

- **Category:** `testing`
- **Trigger:** Glob (`**/*.{test,spec}.{ts,tsx,js,jsx,py},tests/**`)
- **Mandates:** Asserting on behavior and contracts rather than private implementation details; balanced testing pyramid; strict reporting of the six test states; mandatory regression tests for bugfixes; deterministic execution with mocked clocks and third parties.
- **Prohibitions:** Deleting or disabling failing tests to force green runs; tautological assertions (`expect(true).toBe(true)`); sleep-based asynchronous waits; leaking mutable state across tests.

### 14. Performance and efficiency standards (`performance-standards`)

- **Category:** `performance`
- **Trigger:** Model decision (Latency, profiling, memory, scaling)
- **Mandates:** Profile and benchmark before optimizing; algorithmic complexity awareness ($O(1)$/$O(n \log n)$); caching with TTL, invalidation, and stampede prevention; memory leak prevention; non-blocking asynchronous event handling.
- **Prohibitions:** Synchronous disk I/O or heavy computation on the event loop; unbounded in-memory caches without eviction policies; premature micro-optimizations that damage readability.
