---
id: backend-standards
name: Backend Engineering Standards
category: backend
triggerType: glob
globs: "**/*.{ts,js,py,go,java,rs,rb,php}"
description: Backend engineering standards for API design, business logic isolation, database access, transaction boundaries, and error handling.
priority: 7
enforcementLevel: mandatory
platformConfig: {}
---

# Backend Engineering Standards Rule

## Purpose

The Backend Engineering Standards rule governs server-side architectures, API boundaries, business domain logic, and persistent storage interactions. It ensures services are resilient, deterministic, performant, and observable under production workloads.

## Scope and applicability

Applies to all backend service code, HTTP handlers, RPC services, background worker jobs, domain entities, and data access layers across all server runtimes.

## Core standards

- **Layered Boundary Isolation:** Enforce a strict unidirectional boundary separating transport layers (HTTP/gRPC controllers), application use cases, domain business entities, and infrastructure/database adapters.
- **Fail-Fast Request Validation:** Validate all incoming payloads against rigorous schemas at the perimeter before passing data to domain logic or storage layers.
- **Transactional Consistency:** Wrap multi-step state mutations in explicit database transactions; define clear rollback paths and handle concurrency conflicts (optimistic or pessimistic locking).
- **Structured Error Handling:** Map internal errors to clean, standardized HTTP/RPC error contracts. Never leak raw internal database traces or system paths to external clients.
- **Observability and Resource Hygiene:** Emit structured, contextual logs (including correlation/request IDs) and telemetry metrics. Release shared resources (database connections, file descriptors, streams) deterministically using scoped disposers or try-finally blocks.

## Invariants and prohibitions

- **Prohibited:** Executing unvalidated database queries or raw string concatenation vulnerable to SQL injection.
- **Prohibited:** Embedding business decision logic directly within HTTP controllers or database schema definitions.
- **Prohibited:** Swallowing unexpected exceptions with empty catch blocks without logging or propagating errors.
- **Prohibited:** Unbounded in-memory buffering or background processing without backpressure controls and timeouts.

## Verification criteria

- Verify that all API endpoints reject invalid or malformed payloads with 400-series status codes and structured error messages.
- Confirm that database mutations execute within transaction boundaries and rollback reliably on simulated faults.
- Verify through integration tests that services release connections and shut down cleanly on process termination signals.
