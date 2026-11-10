---
name: "architecture"
description: "Use when designing system architectures, evaluating architectural trade-offs, planning service boundaries, database schemas, API contracts, or recording Architecture Decision Records (ADRs)."
---

# Architecture — System Architecture and Technical Design

> Generated from `specs/skills/architecture.md` by `scripts/generate-antigravity-skills.ts`. Edit the canonical specification, not this file.

## Purpose

The Architecture skill provides a disciplined, evidence-based procedure for designing reliable, scalable, and maintainable software systems. It ensures that system decomposition, interface boundaries, persistence layers, and communication topologies are chosen through explicit trade-off evaluation rather than trend-following or premature complexity.

## Activation criteria

Activate this skill when:

- Designing a new system, major subsystem, or greenfield application.
- Evaluating architectural alternatives (e.g., monolith versus microservices, synchronous versus event-driven).
- Defining cross-cutting service boundaries, API contracts, and shared domain models.
- Planning structural database migrations, multi-tenant isolation, or caching hierarchies.
- Documenting significant architectural decisions in Architecture Decision Records (ADRs).

## Non-activation guidelines

Do not activate this skill when:

- Resolving isolated defects within an existing component without changing public contracts.
- Adjusting frontend visual styles, layouts, or component animations.
- Writing unit tests for already defined interfaces.
- Updating dependencies within compatible semver bounds.

## Required context and inputs

Before initiating architectural design, ensure the following inputs are gathered and verified:

1. **Functional Requirements:** Core user journeys, input payloads, business invariants, and expected outputs.
2. **Non-Functional Requirements:** Throughput targets (requests/sec), latency bounds (p95/p99), availability SLAs, data volume projections, and retention policies.
3. **Repository Evidence:** Existing framework conventions, directory structures, language versions, existing database engines, and deployment manifests.
4. **Constraints:** Team size, operational budget, security/compliance regimes (e.g., HIPAA, GDPR, SOC2), and backwards-compatibility requirements.

## Operating procedure

Follow this eleven-step engineering sequence:

1. **Understand Requirements:** Extract explicit requirements and identify unspoken operational constraints.
2. **Inspect Existing Repository:** Map existing component boundaries, entry points, data models, and dependency graphs. Never guess what libraries or databases exist.
3. **Identify System Boundaries:** Group related capabilities by bounded context, identifying clear ownership of state.
4. **Evaluate Architectural Alternatives:** Formulate at least two viable architectural approaches (e.g., modular monolith vs. microservices, synchronous REST vs. async messaging).
5. **Explain Trade-offs:** Score each alternative against operational complexity, performance, scalability, failure domains, and delivery timeline.
6. **Recommend Architecture:** Propose a single primary recommendation with explicit rationale justifying why rejected options were discarded.
7. **Define Components and Interfaces:** Detail service responsibilities, public interfaces, synchronous HTTP/gRPC contracts, and event schemas.
8. **Define Data Flows:** Trace write paths (commands) and read paths (queries), specifying ACID transactional boundaries and eventual consistency tolerances.
9. **Identify Reliability and Security Risks:** Model single points of failure (SPOFs), backpressure management, circuit breaking, rate limiting, and zero-trust authentication boundaries.
10. **Formulate Migration Plan:** If modifying existing systems, define incremental, reversible phases (e.g., Strangler Fig pattern, dual-writing).
11. **Document Decisions:** Record each major conclusion in an Architecture Decision Record (ADR) adhering to the standard format.

## Technical and engineering standards

- **Simplicity First:** Prefer modular monoliths and local procedural calls over distributed microservices unless independent organizational scaling or hardware needs demand separation.
- **Explicit Contracts:** All inter-boundary communication must be backed by typed schemas (JSON Schema, OpenAPI, Protocol Buffers, or TypeScript interfaces).
- **Idempotency:** All asynchronous message handlers and non-idempotent HTTP mutation endpoints (`POST`) that touch financial or state-critical operations must specify idempotency key handling.
- **Persistence Isolation:** Services must not share raw database tables. Communication across bounded contexts must traverse public APIs or verified events.
- **Failure Isolation:** Any external API or database call must include configured timeouts, retries with exponential backoff and jitter, and fallback behavior.

## Verification and evidence requirements

To verify an architectural proposal:

- Validate schema contracts against actual consumer requirements.
- Demonstrate that migration steps are backward-compatible and non-destructive.
- Verify that no circular dependencies exist between identified modules.
- Cite repository source files to prove compatibility with installed runtimes and dependencies.

## Expected outputs and deliverables

- **Architecture Design Document:** Clear prose detailing component decomposition, data models, and network boundaries.
- **Interface Specifications:** OpenAPI schemas, TypeScript types, or Protobuf definitions for new or modified contracts.
- **Architecture Decision Record (ADR):** Formatted Markdown document recording context, options considered, final decision, and consequences.
- **Migration & Rollback Plan:** Phased execution checklist with clear criteria for aborting or rolling back.

## Risks, boundaries and failure modes

- **Over-Engineering Risk:** Recommending Kubernetes, Kafka, or microservices for small-scale applications adds operational drag without technical benefit.
- **Under-Specified Contracts:** Leaving API field types or nullability vague leads to implementation drift and integration failure.
- **Destructive Changes:** Proposing schema drops or breaking API changes without backward-compatibility deprecation windows is an architectural failure.

## Progressive disclosure references

For detailed decision frameworks, trade-off matrices, and ADR authoring templates, refer to:

- [Trade-off Matrix and ADR Authoring Guide](./references/trade-off-and-adr-guide.md)
