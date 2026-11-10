# Documentation index

Product documentation for Frontier Engineer. The original 26-part specification is preserved separately under [frontier-engineer-docs/](../frontier-engineer-docs/fe/README.md) and is treated as an unmodified reference.

## Foundation

| Part | Document                                                           | Coverage                                   |
| ---- | ------------------------------------------------------------------ | ------------------------------------------ |
| 01   | [Project overview](01-PROJECT-OVERVIEW.md)                         | Vision, scope, non-goals, current phase    |
| 02   | [Technology stack](02-TECHNOLOGY-STACK.md)                         | Runtime, authoring formats, tooling        |
| 03   | [System architecture](03-SYSTEM-ARCHITECTURE.md)                   | Layers, lifecycle, agents, delegation      |
| 14   | [Engineering principles](14-ENGINEERING-PRINCIPLES.md)             | The fifteen foundational rules             |
| 15   | [Repository structure](15-REPOSITORY-STRUCTURE.md)                 | Verified plugin layout and discovery paths |
| 24   | [Official format verification](24-OFFICIAL-FORMAT-VERIFICATION.md) | Phase 1 evidence checklist                 |

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

## Decision records

| ADR | Title                                                       |
| --- | ----------------------------------------------------------- |
| 001 | [Foundation decisions](adr/ADR-001-foundation.md)           |
| 002 | [Canonical-first agent system](adr/ADR-002-agent-system.md) |
| 003 | [Skills system architecture](adr/ADR-003-skills-system.md)  |

## Project policies

- [Security policy](../SECURITY.md)
- [Contributing guide](../CONTRIBUTING.md)
- [Changelog](../CHANGELOG.md)

## Implementation plans

- [Phase 3 implementation plan](superpowers/plans/2026-11-10-phase-3-skills-system.md)

## Reading order

1. Start with [the project overview](01-PROJECT-OVERVIEW.md) and [the architecture](03-SYSTEM-ARCHITECTURE.md).
2. Read [the verification record](24-OFFICIAL-FORMAT-VERIFICATION.md) before adding any Antigravity-specific component.
3. For agent work, read [the specifications](04-AGENT-SPECIFICATIONS.md), then [coordination](05-AGENT-COORDINATION.md) and [communication](06-AGENT-COMMUNICATION.md).
4. For skills work, read [skills architecture](09-SKILLS-ARCHITECTURE.md), then [specifications](10-SKILL-SPECIFICATIONS.md) and [activation](11-SKILL-ACTIVATION.md).
5. Consult [portability](07-AGENT-PORTABILITY.md), [repository structure](15-REPOSITORY-STRUCTURE.md) and [ADR-001](adr/ADR-001-foundation.md) when changing the layout.
