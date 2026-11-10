---
trigger: "model_decision"
description: "Security requirements for API endpoints including authentication, authorization checks, rate limiting, and transport security."
---

# API Security Standards Rule

> Generated from `specs/rules/backend/api-security.md` by `scripts/generate-antigravity-rules.ts`. Edit the canonical specification, not this file.

## Purpose

The API Security Standards rule governs the perimeter defense, identity verification, authorization enforcement, and cryptographic transport of server endpoints. It prevents unauthorized access, privilege escalation, data exfiltration, and service abuse.

## Scope and applicability

Applies to all external and internal API contracts, HTTP endpoints, WebSocket connections, GraphQL resolvers, and RPC procedures exposing application data or capabilities.

## Core standards

- **Mandatory Perimeter Authentication:** Verify credentials or cryptographic tokens (JWTs, session cookies, API keys) on all non-public endpoints before invoking application logic.
- **Granular Authorization at the Domain Level:** Enforce role-based (RBAC) or attribute-based (ABAC) access controls on every individual resource request. Verify that the authenticated principal owns or has explicit permission to view or mutate the target entity (preventing Insecure Direct Object References - IDOR).
- **Rate Limiting and Abuse Prevention:** Protect endpoints from brute-force attacks and denial-of-service by applying rate limiting by IP, authenticated user ID, or API key with standard throttling response headers (`429 Too Many Requests`).
- **Transport Security and Header Hardening:** Require TLS 1.2+ across all communication channels; enforce strict CORS policies, and send protective HTTP headers (`Strict-Transport-Security`, `X-Content-Type-Options`, `Content-Security-Policy`).
- **Data Filtering and Masking:** Filter all response payloads to return only the fields required by the client contract; mask or omit passwords, authentication tokens, payment details, and personally identifiable information (PII).

## Invariants and prohibitions

- **Prohibited:** Relying on client-side routing, hidden UI elements, or obfuscated URLs to restrict access to protected resources.
- **Prohibited:** Accepting unvalidated `Origin` headers or using wildcard CORS origins (`*`) alongside credentialed requests.
- **Prohibited:** Logging plaintext passwords, bearer tokens, or full authorization header strings in application logs.
- **Prohibited:** Issuing unbounded tokens without expiration times or revocation capabilities.

## Verification criteria

- Test that unauthenticated requests receive `401 Unauthorized` responses on all protected endpoints.
- Test that authenticated requests attempting cross-tenant or unauthorized resource access receive `403 Forbidden` responses.
- Verify rate limiting enforcement by simulating request bursts and verifying `429` status codes.
