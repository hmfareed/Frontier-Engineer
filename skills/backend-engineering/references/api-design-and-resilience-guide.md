# Backend Engineering: API Architecture, Resilience, and Security Guide

This reference provides technical patterns for robust RESTful APIs, server-side authorization enforcement, error standardization, and resilience patterns.

## 1. RESTful API Contract Standards

### HTTP Methods & Idempotency

- `GET`: Safe, idempotent. Fetches resource representation. Never mutates server state.
- `POST`: Non-safe, non-idempotent. Creates a resource or triggers an action. Must support an `Idempotency-Key` header for financial or critical mutations.
- `PUT`: Non-safe, idempotent. Replaces the resource completely.
- `PATCH`: Non-safe, non-idempotent (or idempotent depending on payload). Partially updates resource.
- `DELETE`: Non-safe, idempotent. Deletes resource. Returns 204 No Content or 200 OK with status.

### Standardized Error Responses (RFC 7807 Problem Details)

All non-2xx responses should return a consistent JSON payload:

```json
{
  "type": "https://api.example.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "The request payload failed schema validation.",
  "instance": "/api/v1/orders/req-98765",
  "invalidParams": [
    {
      "name": "quantity",
      "reason": "Must be an integer greater than zero."
    }
  ]
}
```

---

## 2. Server-Side Security & Invariant Enforcement

### Mandatory Layered Validation

1. **Transport Layer:** HTTPS termination, CORS origin validation, TLS 1.3.
2. **Authentication Middleware:** Verify session cookie or JWT signature, token expiration (`exp`), and revocation status.
3. **Authorization Middleware:** Check that the authenticated entity possesses permissions to act on the target resource. Never allow a user to specify their own `role` or `organization_id` in request payloads.
4. **Schema Validation:** Enforce strict type validation (e.g., Zod, Joi, class-validator) with unknown property stripping (`additionalProperties: false`).
5. **Business Invariant Validation:** Check domain logic (e.g., sufficient account balance, inventory availability) inside an ACID transaction.

---

## 3. Resilience and Fault Tolerance

- **Timeouts:** Every outbound database query, cache access, and third-party HTTP call must have an explicit timeout (e.g., 5 seconds for HTTP, 2 seconds for DB). Never allow requests to hang indefinitely.
- **Circuit Breaking:** For unstable third-party dependencies, implement a circuit breaker (Closed -> Open -> Half-Open) to fail fast when downstream services are down.
- **Backoff & Jitter:** Exponential backoff for transient failures (`base * 2^attempt + jitter`) to avoid synchronized thundering herd spikes.
- **Structured Logging:** Log in JSON format containing timestamp, log level, correlation/request ID, user/tenant ID (no PII or secrets), and duration.
