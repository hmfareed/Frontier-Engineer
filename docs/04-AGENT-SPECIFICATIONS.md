# Part 04 — Agent specifications

## Canonical-first architecture

Frontier Engineer's agent intelligence is **not** tied to Antigravity. Each agent has a platform-independent canonical specification in [specs/agents/](../specs/agents/) that separates identity and purpose, responsibilities, instructions, input requirements, expected outputs, decision-making procedures, handoff protocols, tool requirements, and deliverables. Canonical frontmatter sets `platformConfig: {}` and the validator rejects any non-empty value, so platform-specific configuration cannot leak into the source of truth.

The [Antigravity generator](../scripts/generate-antigravity-agents.ts) reads those six specifications and emits the loader-visible files in [agents/](../agents/). Generated files carry an explicit "do not edit" notice; the canonical specs are the only place agent instructions are maintained. See [Part 07](07-AGENT-PORTABILITY.md) for adapter architecture.

## The six agents

| ID                        | Role                                                     | Kind                             | Canonical spec                                     | Generated adapter                               |
| ------------------------- | -------------------------------------------------------- | -------------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| `frontier-engineer`       | Lead Software Engineering Coordinator                    | coordinator (primary)            | [spec](../specs/agents/frontier-engineer.md)       | [adapter](../agents/frontier-engineer.md)       |
| `architect`               | Principal Software Architect                             | specialist (subagent)            | [spec](../specs/agents/architect.md)               | [adapter](../agents/architect.md)               |
| `implementation-engineer` | Senior Full-Stack Software Engineer                      | specialist (subagent)            | [spec](../specs/agents/implementation-engineer.md) | [adapter](../agents/implementation-engineer.md) |
| `security-auditor`        | Application Security Specialist                          | specialist (subagent, read-only) | [spec](../specs/agents/security-auditor.md)        | [adapter](../agents/security-auditor.md)        |
| `qa-engineer`             | Senior QA and Test Automation Engineer                   | specialist (subagent)            | [spec](../specs/agents/qa-engineer.md)             | [adapter](../agents/qa-engineer.md)             |
| `design-engineer`         | Senior Product Designer and Frontend Experience Engineer | specialist (subagent)            | [spec](../specs/agents/design-engineer.md)         | [adapter](../agents/design-engineer.md)         |

Every canonical specification contains the same eleven sections: Identity, Purpose, Responsibilities, Instructions, Input requirements, Expected outputs, Decision-making procedures, Handoff protocol, Tool requirements, Deliverables, and Restrictions. The validator enforces this so no agent can degrade into a generic prompt.

### Frontier Engineer — Lead Coordinator

The default entry point for substantial work. It understands requirements, inspects the repository, classifies complexity and risk, plans, delegates selectively, reconciles specialist findings, supervises implementation, verifies, and produces the final report. Its final report must contain objective, work performed, files changed, technical decisions, tests executed, verification results, security considerations, known limitations, and outstanding work.

### Architect

Advisory by default and read-only. It designs reliable, scalable, maintainable systems, evaluates at least two approaches with explicit trade-offs, defines boundaries, data models and API contracts, and records Architecture Decision Records. It must not introduce microservices without justification, recommend technologies because they are popular, or redesign functioning systems.

### Implementation Engineer

Owns code changes. It adapts to the technologies actually present, makes focused changes following existing conventions, handles loading, empty, error and success states, validates input, and verifies results. It must not present fake implementations as complete, introduce unnecessary dependencies, or claim success without verification.

### Security Auditor

Independent and read-only. It audits OWASP Top 10 areas, classifies findings as Critical / High / Medium / Low / Informational, and every finding includes title, severity, affected component, evidence, attack scenario, impact, remediation, and verification status. It distinguishes confirmed vulnerabilities from theoretical risks and never claims a system is secure because nothing obvious was found.

### QA Engineer

Guardian of honest verification. It extracts acceptance criteria, designs and executes tests, analyses failures, and keeps Passed, Failed, Blocked, Not executed, and Not applicable distinct. It never fabricates results, never weakens tests to make code pass, and never treats compilation as proof of correctness.

### Design Engineer

Bridges visual design and frontend engineering. It inspects the existing design system, defines hierarchy, responsive behaviour, the ten interaction states (default, hover, focus, active, disabled, loading, empty, error, success, responsive/mobile), and checks accessibility before aesthetics. It does not redesign unrelated pages or present placeholders as complete.

## Shared protocols

- [Part 05 — Coordination, delegation and conflict prevention](05-AGENT-COORDINATION.md)
- [Part 06 — Communication and handoff contract](06-AGENT-COMMUNICATION.md)
- [Part 08 — Evaluation scenarios and rubric](08-AGENT-EVALUATION.md)

## Verified vs unverified

**Verified:** the six generated files are discovered by the installed Antigravity CLI. `agy plugin validate --strict .` reports `components.agents: 6` with zero findings, and the frontmatter uses only officially documented fields. Delegation via `invoke_subagent`, clean subagent context, concurrent execution, message-based inter-agent communication, and the 10-level nesting limit are documented officially.

**Not verified:** runtime invocation, actual specialist delegation, handoff transport through a real subagent session, and inter-agent message passing. No claim of a functioning multi-agent execution is made. Installing the plugin and exercising a task is deferred until runtime testing is authorised.

## Known limitations

- No `tools` allowlist is emitted. Official documentation conflicts on the default (`[]` versus all tools) and warns that misspelled tool names can hang subagents. Capability requirements are recorded per agent in [Part 05](05-AGENT-COORDINATION.md) and enforced behaviourally through `commandExecutionPolicy: sandbox`, prompt restrictions and approval rules.
- The ten skills (Phase 3) and MCP integrations (Phase 5) do not exist, so `skills` and `mcpServers` frontmatter is deliberately absent.
- `inheritMcp` and `inheritCustomizations` are omitted because they appear in the plugin guide but not in the custom subagents reference.
