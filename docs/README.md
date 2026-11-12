# Documentation index

Product documentation for Frontier Engineer. The original 26-part specification is preserved separately under [frontier-engineer-docs/](../frontier-engineer-docs/fe/README.md) and is treated as an unmodified reference.

## Foundation

| Part | Document                                                           | Coverage                                   |
| ---- | ------------------------------------------------------------------ | ------------------------------------------ |
| 01   | [Project overview](01-PROJECT-OVERVIEW.md)                         | Vision, scope, non-goals, current phase    |
| 02   | [Technology stack](02-TECHNOLOGY-STACK.md)                         | Runtime, authoring formats, tooling        |
| 03   | [System architecture](03-SYSTEM-ARCHITECTURE.md)                   | Layers, lifecycle, agents, delegation      |
| 14   | [Engineering principles](14-ENGINEERING-PRINCIPLES.md)             | The fifteen foundational rules             |
| 20   | [Repository structure](20-REPOSITORY-STRUCTURE.md)                 | Verified plugin layout and discovery paths |
| 27   | [Official format verification](27-OFFICIAL-FORMAT-VERIFICATION.md) | Phase 1 evidence checklist                 |

## Agent system (Phase 2)

| Part | Document                                           | Coverage                                                   |
| ---- | -------------------------------------------------- | ---------------------------------------------------------- |
| 04   | [Agent specifications](04-AGENT-SPECIFICATIONS.md) | Six agents, canonical architecture, verified vs unverified |
| 05   | [Agent coordination](05-AGENT-COORDINATION.md)     | Delegation, conflict prevention, capability matrix         |
| 06   | [Agent communication](06-AGENT-COMMUNICATION.md)   | Handoff and response contract                              |
| 07   | [Agent portability](07-AGENT-PORTABILITY.md)       | Canonical specs, adapters, unimplemented targets           |
| 08   | [Agent evaluation](08-AGENT-EVALUATION.md)         | Nineteen scenarios, rubric, no scores assigned             |

## Skills system (Phase 3)

| Part | Document                                                 | Coverage                                                    |
| ---- | -------------------------------------------------------- | ----------------------------------------------------------- |
| 09   | [Skills architecture](09-SKILLS-ARCHITECTURE.md)         | Ten skills, progressive disclosure, canonical-first design  |
| 10   | [Skill specifications](10-SKILL-SPECIFICATIONS.md)       | Catalog of all ten engineering skills                       |
| 11   | [Skill activation](11-SKILL-ACTIVATION.md)               | Selective activation matrix, triggers, non-activation rules |
| 12   | [Skill-agent integration](12-SKILL-AGENT-INTEGRATION.md) | Mapping skills to the six agent roles, handoff integration  |
| 13   | [Skill portability](13-SKILL-PORTABILITY.md)             | Portability across Antigravity, Claude Code, Codex, Cursor  |

## Rules system (Phase 4)

| Part | Document                                                         | Coverage                                                 |
| ---- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| 15   | [Rules architecture](15-RULES-ARCHITECTURE.md)                   | Fourteen rules, two layers, canonical compilation        |
| 16   | [Rule specifications](16-RULE-SPECIFICATIONS.md)                 | Complete catalog of 14 rules and standards               |
| 17   | [Rule activation](17-RULE-ACTIVATION.md)                         | Always-on, path-triggered (glob), and model-decision     |
| 18   | [Rule priority and conflicts](18-RULE-PRIORITY-AND-CONFLICTS.md) | Priority scale 1-10, conflict resolution hierarchy       |
| 19   | [Rule portability](19-RULE-PORTABILITY.md)                       | Canonical specs, Antigravity flat scan, platform mapping |

## MCP integration subsystem (Phase 5)

| Part | Document                                     | Coverage                                                   |
| ---- | -------------------------------------------- | ---------------------------------------------------------- |
| 21   | [MCP architecture](21-MCP-ARCHITECTURE.md)   | Five integrations, 3-tier canonical specs, registry        |
| 22   | [MCP integrations](22-MCP-INTEGRATIONS.md)   | Detailed specs: GitHub, Context7, Playwright, Sentry, DB   |
| 23   | [MCP security](23-MCP-SECURITY.md)           | 5 permission classes, prompt injection, token hygiene      |
| 24   | [MCP configuration](24-MCP-CONFIGURATION.md) | Antigravity mcp_config.json, env vars, zero commit         |
| 25   | [MCP portability](25-MCP-PORTABILITY.md)     | Platform mapping: Antigravity, Claude Code, Cursor, Codex  |
| 26   | [MCP operations](26-MCP-OPERATIONS.md)       | Health checks, audit logging, fallbacks, incident response |

## Lifecycle hooks subsystem (Phase 6)

| Part | Document                                           | Coverage                                                     |
| ---- | -------------------------------------------------- | ------------------------------------------------------------ |
| 28   | [Hooks architecture](28-HOOKS-ARCHITECTURE.md)     | Execution-time safeguards, 6 lifecycle events, agent loop    |
| 29   | [Hooks specifications](29-HOOKS-SPECIFICATIONS.md) | Six canonical hooks, contracts, timeouts, and handlers       |
| 30   | [Hooks security](30-HOOKS-SECURITY.md)             | Permission matrix, fail-closed policy, threat mitigations    |
| 31   | [Hooks runtime](31-HOOKS-RUNTIME.md)               | Runtime modules, stdin/stdout protocol, Windows support      |
| 32   | [Hooks testing](32-HOOKS-TESTING.md)               | 15 adversarial scenarios, live acceptance HOOK-01 to HOOK-10 |
| 33   | [Hooks portability](33-HOOKS-PORTABILITY.md)       | Canonical policies, Antigravity adapter, planned platforms   |

## Repository intelligence subsystem (Phase 7)

| Part | Document                                                     | Coverage                                                  |
| ---- | ------------------------------------------------------------ | --------------------------------------------------------- |
| 34   | [Storage architecture](34-STORAGE-ARCHITECTURE.md)           | SQLite relational storage, migrations, snapshot promotion |
| 35   | [Graph engine architecture](35-GRAPH-ENGINE-ARCHITECTURE.md) | Deterministic engineering graph, cycle-safe traversals    |
| 36   | [Architecture intelligence](36-ARCHITECTURE-INTELLIGENCE.md) | Evidence-based entrypoint, component, and test discovery  |

## Decision records

| ADR | Title                                                                       |
| --- | --------------------------------------------------------------------------- |
| 001 | [Foundation decisions](adr/ADR-001-foundation.md)                           |
| 002 | [Canonical-first agent system](adr/ADR-002-agent-system.md)                 |
| 003 | [Skills system architecture](adr/ADR-003-skills-system.md)                  |
| 004 | [Rules system architecture](adr/ADR-004-rules-system.md)                    |
| 005 | [MCP integration architecture](adr/ADR-005-mcp-integration-architecture.md) |
| 006 | [Lifecycle hooks architecture](adr/ADR-006-lifecycle-hooks-architecture.md) |
| 007 | [Storage and graph engine](adr/ADR-007-storage-and-graph-engine.md)         |

## Project policies

- [Security policy](../SECURITY.md)
- [Contributing guide](../CONTRIBUTING.md)
- [Changelog](../CHANGELOG.md)

## Implementation plans

- [Phase 3 implementation plan](superpowers/plans/2026-11-10-phase-3-skills-system.md)
- [Phase 4 implementation plan](superpowers/plans/2026-11-10-phase-4-rules-system.md)
- [Phase 7.2 implementation plan](superpowers/plans/2026-11-11-phase-7-2-structural-extractors.md)

## Reading order

1. Start with [the project overview](01-PROJECT-OVERVIEW.md) and [the architecture](03-SYSTEM-ARCHITECTURE.md).
2. Read [the verification record](27-OFFICIAL-FORMAT-VERIFICATION.md) before adding any Antigravity-specific component.
3. For agent work, read [the specifications](04-AGENT-SPECIFICATIONS.md), then [coordination](05-AGENT-COORDINATION.md) and [communication](06-AGENT-COMMUNICATION.md).
4. For skills work, read [skills architecture](09-SKILLS-ARCHITECTURE.md), then [specifications](10-SKILL-SPECIFICATIONS.md) and [activation](11-SKILL-ACTIVATION.md).
5. For rules work, read [rules architecture](15-RULES-ARCHITECTURE.md), then [specifications](16-RULE-SPECIFICATIONS.md) and [priority and conflicts](18-RULE-PRIORITY-AND-CONFLICTS.md).
6. For MCP integrations, read [MCP architecture](21-MCP-ARCHITECTURE.md), then [security](23-MCP-SECURITY.md), [configuration](24-MCP-CONFIGURATION.md), and [ADR-005](adr/ADR-005-mcp-integration-architecture.md).
7. Consult [portability](07-AGENT-PORTABILITY.md), [repository structure](20-REPOSITORY-STRUCTURE.md) and [ADR-001](adr/ADR-001-foundation.md) when changing the layout.
