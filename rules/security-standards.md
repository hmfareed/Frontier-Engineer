---
trigger: "model_decision"
description: "Core application security principles covering the OWASP Top 10, input sanitization, cryptography, and defense-in-depth."
---

# Application Security Standards Rule

> Generated from `specs/rules/security/security-standards.md` by `scripts/generate-antigravity-rules.ts`. Edit the canonical specification, not this file.

## Purpose

The Application Security Standards rule enforces defense-in-depth engineering to protect systems, data, and users from malicious exploitation. It establishes rigorous guardrails against the OWASP Top 10 vulnerabilities, unauthorized privilege escalation, and data compromise.

## Scope and applicability

Applies across all architectural layers, services, endpoints, data stores, third-party integrations, and utilities within the repository.

## Core standards

- **Defense in Depth:** Implement validation and security checks at every architectural boundary (client validation, perimeter gateway, service application, and database constraints). Never rely on a single defensive layer.
- **Strict Parameterized Queries:** Always use parameterized statements, prepared queries, or safe ORM bindings for database operations to prevent SQL, NoSQL, and command injection attacks.
- **Context-Aware Output Encoding:** Encode all untrusted or dynamic data before rendering into HTML, JavaScript, CSS, or shell contexts to eliminate Cross-Site Scripting (XSS) and injection risks.
- **Modern Cryptography:** Use modern, battle-tested cryptographic primitives and algorithms (e.g. Argon2id or bcrypt for password hashing; AES-256-GCM or ChaCha20-Poly1305 for authenticated symmetric encryption; TLS 1.2+ for in-transit communication). Avoid deprecated primitives (MD5, SHA1, DES, RC4, ECB mode).
- **Principle of Least Privilege:** Grant services, database connections, container runtimes, and individual users only the minimal permissions required to perform their specific business functions.

## Invariants and prohibitions

- **Prohibited:** Custom cryptographic algorithms, home-grown hashing functions, or rolling custom encryption logic.
- **Prohibited:** Storing passwords, API tokens, or credit card numbers in plaintext or using reversible encryption for credentials.
- **Prohibited:** Executing user input directly in shell interpreters, system command invocations (`eval`, `exec`, `system`), or unvalidated XML/deserialization parsers.
- **Prohibited:** Using packages or libraries with known, unpatched high-severity CVE vulnerabilities.

## Verification criteria

- Execute automated static application security testing (SAST) and dependency vulnerability scans (`npm audit`, `pip-audit`, or equivalent) with zero critical/high findings.
- Verify through security test suites that injection payloads (SQLi, XSS, path traversal) are safely neutralized.
- Audit cryptographic implementations to verify current, approved algorithms and key lengths.
