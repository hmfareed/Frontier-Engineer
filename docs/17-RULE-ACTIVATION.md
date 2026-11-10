# Part 17 — Rule activation

## Activation mechanisms

Rules in Frontier Engineer are intentionally not injected indiscriminately into the agent's context window. Dumping thousands of lines of engineering rules into every prompt degrades agent focus, consumes valuable context budget, and increases inference latency.

Instead, Frontier Engineer employs a **three-tier activation model**:

```text
┌────────────────────────────────────────────────────────┐
│ 1. ALWAYS-ON (Global Baseline)                         │
│    - File: rules/AGENTS.md                             │
│    - Scope: Loaded unconditionally in every turn       │
│    - Content: 15 Core Principles, Verification Rules   │
└────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 2. PATH-TRIGGERED / GLOB MATCHING                      │
│    - Trigger: trigger: "glob"                          │
│    - Condition: Active file paths match glob patterns  │
│    - Examples: **/*.sql -> database-standards          │
│                **/*.test.ts -> testing-standards       │
└────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 3. SEMANTIC / MODEL DECISION                           │
│    - Trigger: trigger: "model_decision"                │
│    - Condition: Query intent or task domain matches    │
│    - Examples: Security audits -> security-standards   │
│                Optimization -> performance-standards   │
└────────────────────────────────────────────────────────┘
```

## Trigger types and syntax

### 1. Always-on rules

- **Indicator:** Absence of YAML frontmatter (in Antigravity) or canonical `triggerType: "always_on"`.
- **Target:** `rules/AGENTS.md`.
- **Lifecycle:** Loaded into the system prompt across all primary and specialist agent invocations.
- **Content:** Minimal, high-level invariants that must never be violated regardless of domain.

### 2. Glob-triggered rules

- **Indicator:** Frontmatter `trigger: "glob"` with a comma-separated `globs` pattern string.
- **Lifecycle:** Dynamically injected into context when the agent reads, edits, or inspects files matching the specified patterns.
- **Rule Mappings:**
  - `general-engineering`: `**/*.{ts,tsx,js,jsx,py,go,java,rs,c,cpp,cs}`
  - `code-quality`: `**/*.{ts,tsx,js,jsx,py,go,java,rs,c,cpp,cs}`
  - `documentation`: `**/*.{md,mdx},docs/**`
  - `frontend-standards`: `**/*.{tsx,jsx,vue,svelte,css,scss,html}`
  - `accessibility`: `**/*.{tsx,jsx,vue,svelte,html}`
  - `backend-standards`: `**/*.{ts,js,py,go,java,rs,rb,php}`
  - `database-standards`: `**/*.{sql,prisma,schema,db}`
  - `migration-safety`: `**/migrations/**,**/*.sql`
  - `secrets-management`: `**/*.{env*,json,yaml,yml,conf,config,ini,toml}`
  - `testing-standards`: `**/*.{test,spec}.{ts,tsx,js,jsx,py},tests/**`

### 3. Model-decision rules

- **Indicator:** Frontmatter `trigger: "model_decision"` with a concise semantic `description`.
- **Lifecycle:** Evaluated by the agent's intent classification layer based on the user's prompt and active task context.
- **Rule Mappings:**
  - `api-security`: Activated when designing or reviewing authentication, authorization, or public API endpoints.
  - `security-standards`: Activated when conducting security reviews, vulnerability remediation, or cryptographic tasks.
  - `performance-standards`: Activated when profiling bottlenecks, optimizing latency, or addressing resource leaks.

## Context window economy

By separating specialized standards from the global rule file, Frontier Engineer optimizes token utilization:

| Task Type                           | Active Rules                                                                              | Token Overhead |
| :---------------------------------- | :---------------------------------------------------------------------------------------- | :------------- |
| Initial User Greeting / Planning    | `AGENTS.md`                                                                               | ~400 tokens    |
| Editing TypeScript React Component  | `AGENTS.md`, `general-engineering`, `code-quality`, `frontend-standards`, `accessibility` | ~2,500 tokens  |
| Writing Unit and Integration Tests  | `AGENTS.md`, `general-engineering`, `code-quality`, `testing-standards`                   | ~2,200 tokens  |
| Executing Database Migration        | `AGENTS.md`, `database-standards`, `migration-safety`                                     | ~1,800 tokens  |
| Reviewing Environment Configuration | `AGENTS.md`, `secrets-management`                                                         | ~1,100 tokens  |

This selective activation prevents context dilution and ensures agents remain focused on the relevant constraints for their immediate task.
