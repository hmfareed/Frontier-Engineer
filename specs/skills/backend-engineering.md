---
id: backend-engineering
name: Backend Engineering
title: Resilient Backend Services, APIs, and Business Logic
version: 1
summary: Builds reliable, secure, and maintainable backend systems. Designs REST/GraphQL APIs, enforces server-side authentication and authorization, manages database access, background queues, caching, rate limiting, and observability.
description: Use when building or refactoring backend services, RESTful APIs, business logic, authentication/authorization pipelines, background workers, database transactions, third-party integrations, or error handling systems.
requiredCapabilities:
  - repository-inspection
  - code-editing
  - api-design
  - data-modeling
  - test-execution
  - security-review
primaryAgents:
  - implementation-engineer
  - architect
  - frontier-engineer
activationTriggers:
  - designing or implementing RESTful or GraphQL endpoints
  - developing business logic, service layers, and domain entities
  - implementing server-side authentication, authorization, and session handling
  - configuring background task workers, job queues, or scheduled automations
  - integrating database queries, connection pools, or transactions
nonActivationGuidelines:
  - client-side DOM manipulation or CSS styling
  - native mobile client UI layouts
  - non-functional marketing copy updates
  - standalone infrastructure provisioning without service implementation
platformConfig: {}
---

# Backend Engineering (canonical specification)

## Purpose

The Backend Engineering skill provides a disciplined methodology for building robust, secure, and maintainable server-side applications. It ensures that business logic, API contracts, persistence integrations, and background processors are architected for fault tolerance, data integrity, and strict server-side authorization enforcement.

## Activation criteria

Activate this skill when:

- Creating, modifying, or refactoring backend endpoints, controllers, or service classes.
- Implementing domain business logic, data validation, and workflow state machines.
- Establishing server-side authentication, authorization gates, and multi-tenant scoping.
- Interfacing with databases, caches, message brokers, and third-party APIs.
- Authoring background workers, queues, scheduled cron jobs, and event consumers.

## Non-activation guidelines

Do not activate this skill when:

- Authoring client-side React components or CSS styling without backend API changes.
- Writing pure documentation or user guides.
- Performing visual design or UI accessibility audits.
- Conducting isolated database query performance profiling without code modifications (use Database Engineering).

## Required context and inputs

Before implementing backend code:

1. **Existing Architecture:** Runtime (Node.js, Go, Python, Java), web framework (Express, Fastify, Nest, Django, etc.), ORM/query builder, and project layout.
2. **API Requirements:** HTTP methods, route paths, request payloads, response structures, status codes, and query parameters.
3. **Security Invariants:** Required user roles, tenant ownership rules, rate limits, and sensitive data protection requirements.
4. **Persistence Layer:** Database engine (PostgreSQL, MySQL, Redis, MongoDB), existing schemas, migrations, and relationship constraints.

## Operating procedure

Execute the following twelve-step backend engineering workflow:

1. **Inspect Existing Backend:** Review the existing directory structure, framework idioms, middleware chains, and service layering.
2. **Understand Requirements:** Identify functional inputs, outputs, validation constraints, and non-functional latency/throughput targets.
3. **Define Service Responsibilities:** Separate HTTP routing concerns from business logic and database persistence (Controller -> Service -> Repository).
4. **Design API Contracts:** Define strict request and response schemas adhering to RESTful standards or GraphQL schemas.
5. **Validate Inputs:** Enforce schema validation at the controller boundary; reject unexpected fields (`additionalProperties: false`) with 422/400 errors.
6. **Implement Business Logic:** Write domain algorithms and state transitions, ensuring transactional boundaries around multi-step writes.
7. **Enforce Authorization Server-Side:** Verify permissions against the authenticated user and their organization/tenant ID before touching resources.
8. **Integrate Persistence:** Implement parameterized database queries or repository calls; handle connection releases and transactions gracefully.
9. **Handle Failures & Errors:** Catch exceptions, transform domain errors into RFC 7807 problem details, and log internal errors without leaking details to clients.
10. **Add Appropriate Logging & Metrics:** Emit structured logs with correlation/request IDs, log levels, and execution timings.
11. **Write Automated Tests:** Create unit tests for business logic and integration tests for endpoints using test fixtures or in-memory DBs.
12. **Verify Implementation:** Execute test suites, check linting and type safety, and verify error code handling.

## Technical and engineering standards

- **Never Trust the Client:** Client input is untrusted data. Validate all types, string lengths, ranges, and formats before processing.
- **Server-Side Authorization:** Never allow client-supplied IDs (e.g. `userId` in POST body) to override the identity derived from verified session tokens.
- **Explicit Transaction Boundaries:** Any operation that updates multiple tables or records must run inside an atomic database transaction.
- **Idempotency for Mutations:** Critical mutation endpoints (`POST /charges`, `POST /orders`) must support `Idempotency-Key` headers to prevent duplicate operations on network retries.
- **Leak-Free Errors:** Never return SQL syntax errors, database table names, or call stack traces in API response bodies.
- **Timeouts & Deadlines:** Every external network request or DB query must have an enforced timeout.

## Verification and evidence requirements

- Provide automated integration tests proving the endpoint returns expected 2xx responses on valid payloads.
- Provide negative tests proving the endpoint returns 400/422 on invalid schema, 401 on missing auth, and 403 on unauthorized access.
- Inspect logs to confirm structured logging output with correlation IDs.

## Expected outputs and deliverables

- **API Route & Controller Code:** Clean, typed handlers managing HTTP request parsing and response dispatch.
- **Domain Service Layer:** Business logic separated from HTTP transport.
- **Data Access & Schema Layer:** Parameterized queries or ORM models respecting database constraints.
- **Automated Tests:** Unit tests for services and integration tests for endpoints.

## Risks, boundaries and failure modes

- **Client Identity Spoofing:** Reading `req.body.userId` to authorize an action creates an immediate IDOR vulnerability.
- **Resource Leaks:** Failing to release database pool connections or file descriptors in error paths leads to server crashes under load.
- **Silent Failures:** Wrapping code in empty `catch {}` blocks prevents debugging and leads to silent data corruption.

## Progressive disclosure references

For REST design standards, RFC 7807 error patterns, and resilience principles:

- [Backend Engineering: API Architecture, Resilience, and Security Guide](./references/backend-engineering/api-design-and-resilience-guide.md)
