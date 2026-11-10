# Architecture Decision Records and System Trade-off Evaluation Guide

This reference provides concrete decision frameworks, trade-off matrices, and templates for system architecture engineering.

## 1. System Decomposition Decision Matrix

When choosing between monolithic, modular monolithic, service-oriented, and event-driven patterns, evaluate against concrete operational constraints:

| Dimension                 | Monolith / Modular Monolith                              | Microservices / Distributed                                        | Event-Driven Architecture                                    |
| :------------------------ | :------------------------------------------------------- | :----------------------------------------------------------------- | :----------------------------------------------------------- |
| **Team Size**             | 1–15 engineers; single deployment pipeline               | Multiple independent teams with distinct service boundaries        | Asynchronous producer-consumer teams                         |
| **Operational Overhead**  | Low: single process, unified logging, local transactions | High: distributed tracing, service discovery, network partitioning | High: dead-letter queues, out-of-order delivery, idempotency |
| **Data Consistency**      | ACID transactions, immediate consistency                 | Sagas, two-phase commit, eventual consistency                      | Eventual consistency, event sourcing or CDC                  |
| **Latency**               | In-process method calls (<1ms)                           | Network RPC/HTTP overhead (5–50ms per hop)                         | Asynchronous decoupled queuing                               |
| **Deployment Complexity** | All-or-nothing deploys; fast rollback                    | Independent zero-downtime canary deploys                           | Independent worker scaling and consumers                     |

> **Default Rule:** Always start with a well-factored modular monolith unless independent deployment, disparate technology stacks, or distinct scaling dimensions are demonstrated by evidence.

---

## 2. Distributed Communication Protocols

Choose transport protocols based on latency, coupling, and payload characteristics:

1. **Synchronous REST (JSON/HTTP):**
   - Standard public and internal API contract.
   - Idempotent verbs: `GET`, `PUT`, `DELETE`.
   - Non-idempotent: `POST`.
   - Error standard: RFC 7807 (Problem Details for HTTP APIs).
2. **Synchronous gRPC / Protocol Buffers:**
   - Low-latency internal microservice communication.
   - Strongly-typed contracts with binary serialization.
   - Streaming capabilities (bidirectional, server-streaming).
3. **Asynchronous Message Broker (RabbitMQ, Apache Kafka, AWS SQS):**
   - Decoupled event publishing and high-throughput ingestion.
   - Mandatory idempotency: every event consumer must verify event IDs before processing.
   - Dead Letter Queues (DLQ) required for unparseable or repeatedly failing messages.

---

## 3. Caching Strategy and Invalidation

Never introduce caching without defining the invalidation mechanism and TTL:

- **Cache-Aside (Lazy Loading):** Application queries cache first; on miss, queries database and populates cache with TTL. Suitable for read-heavy workloads with tolerable cache warmup.
- **Write-Through:** Application writes to cache and database simultaneously. Ensures cache freshness; higher write latency.
- **Write-Behind (Write-Back):** Application writes to cache immediately; cache asynchronously writes to DB. High throughput; risk of data loss on cache failure.
- **Cache Invalidation Principles:**
  - Prefer event-driven invalidation or precise key tagging over broad wildcard deletes.
  - Mitigate cache stampede (thundering herd) using mutex locks or probabilistic early expiration.

---

## 4. Architecture Decision Record (ADR) Template

Every significant architectural decision must be documented using this standard template:

```markdown
# ADR-[NUMBER]: [TITLE]

- **Status:** [Proposed | Accepted | Deprecated | Superseded]
- **Date:** YYYY-MM-DD
- **Deciders:** [Names / Roles]
- **Context:**
  - What is the business or technical context driving this decision?
  - What constraints (team, performance, cost, security) apply?
- **Alternatives Considered:**
  1. [Alternative A]: Pros and Cons.
  2. [Alternative B]: Pros and Cons.
- **Decision:**
  - What architecture, pattern, or technology was selected?
  - Why was it chosen over the alternatives?
- **Consequences:**
  - Positive consequences (what becomes easier).
  - Negative consequences and trade-offs (what becomes harder or requires management).
  - Migration / Implementation path.
```
