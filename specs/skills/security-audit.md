---
id: security-audit
name: Security Audit
title: Application Security Review and Vulnerability Assessment
version: 1
summary: Performs systematic, evidence-based security audits. Inspects OWASP Top 10 vulnerabilities, authentication, authorization, session handling, input validation, SQLi, XSS, CSRF, SSRF, secret management, and dependencies.
description: Use when conducting security reviews, vulnerability assessments, threat modeling, auditing authentication/authorization logic, reviewing secrets handling, or verifying remediation of security defects.
requiredCapabilities:
  - repository-inspection
  - security-review
  - threat-modeling
  - dependency-analysis
  - documentation
primaryAgents:
  - security-auditor
  - frontier-engineer
activationTriggers:
  - reviewing authentication and session management systems
  - auditing authorization boundaries and access control rules
  - implementing external webhook or third-party API integrations
  - reviewing file upload or user input ingestion mechanisms
  - preparing for production security assessments or compliance reviews
nonActivationGuidelines:
  - purely stylistic code formatting or naming adjustments
  - internal unit test assertions that do not touch security boundaries
  - client-side UI animations without user input or credential handling
  - non-functional documentation updates
platformConfig: {}
---

# Security Audit (canonical specification)

## Purpose

The Security Audit skill provides a systematic, evidence-based methodology for identifying, classifying, and remediating software security vulnerabilities. It guards applications against the OWASP Top 10, insecure authorization, secret leaks, and architectural flaws by requiring concrete exploit scenarios and verified remediations rather than theoretical assertions.

## Activation criteria

Activate this skill when:

- Authoring or modifying authentication, session management, or password reset logic.
- Adding or altering authorization middleware, role-based access controls (RBAC), or multi-tenant filters.
- Exposing new public API endpoints, webhooks, or file upload handlers.
- Ingesting untrusted user data into persistence engines, template renderers, or system shells.
- Conducting pre-deployment security reviews or dependency vulnerability audits.

## Non-activation guidelines

Do not activate this skill when:

- Modifying UI layouts, CSS themes, or visual component state transitions that do not handle user inputs or credentials.
- Writing unit tests for deterministic mathematical algorithms.
- Updating developer documentation or internal code comments.
- Refactoring internal private functions without changing security posture or external interfaces.

## Required context and inputs

Before initiating a security audit, inspect and assemble:

1. **Threat Model & Architecture:** Application topology, public entry points, internal service boundaries, and external third-party dependencies.
2. **Authentication Mechanisms:** Session cookies, JWTs, OAuth2 providers, and API token validation logic.
3. **Authorization Models:** User roles, tenant IDs, permission checks, and database query filters.
4. **Data Flows:** Ingestion points for user input, file uploads, external webhooks, and outbound network calls.
5. **Configuration & Secrets:** Environment variables, Dockerfiles, CI/CD pipelines, and secret manager configurations.

## Operating procedure

Execute the following thirteen-step security auditing workflow:

1. **Understand Application Architecture:** Map all public, internal, and administrative network boundaries.
2. **Establish the Threat Model:** Identify potential adversaries, assets of value (PII, financial data, admin tokens), and plausible attack vectors.
3. **Identify Attack Surfaces:** Enumerate all public routes, RPC methods, WebSocket handlers, and webhook receivers.
4. **Inspect Authentication:** Audit password hashing algorithms (bcrypt/Argon2id), session invalidation on logout, token expiration, and MFA enforcement.
5. **Inspect Authorization:** Test for Insecure Direct Object References (IDOR), missing function-level access control, and tenant isolation at the database layer.
6. **Inspect API Endpoints:** Check rate limiting, request size limits, CORS policies, and HTTP security headers (`Content-Security-Policy`, `X-Content-Type-Options`).
7. **Inspect Input Validation:** Verify schema enforcement, data sanitization, type coercion, and rejection of unexpected fields.
8. **Inspect Database Interactions:** Check for raw string interpolation in SQL/NoSQL queries, unescaped queries in ORMs, and mass assignment vulnerabilities.
9. **Inspect Secrets and Configuration:** Scan repository for hardcoded API keys, certificates, or default credentials. Verify that secrets are injected via secure runtime variables.
10. **Identify Vulnerabilities:** Document every potential vulnerability with code references and realistic exploit mechanics.
11. **Classify Severity:** Assign severity ratings (Critical, High, Medium, Low, Informational) based on exploitability and business impact.
12. **Recommend Concrete Remediation:** Provide exact code patches or configuration directives that eliminate the vulnerability without introducing regressions.
13. **Verify Remediations:** Re-inspect modified code or execute non-destructive proof-of-concept tests to confirm the vulnerability is closed.

## Technical and engineering standards

- **Never Trust Client Claims:** All authorization checks must be enforced server-side. Never rely on client-side role flags, hidden form inputs, or unverified JWT claims.
- **Parameterized Queries:** Every SQL/database interaction must utilize parameterized statements or prepared queries. Zero raw string concatenation allowed.
- **Secure by Default:** Set `HttpOnly`, `Secure`, and `SameSite=Lax` or `Strict` on all authentication cookies. Enforce strict HTTPS redirection.
- **Least Privilege:** Database connection strings, service accounts, and API tokens must have the absolute minimum permissions required for their task.
- **Safe Error Responses:** Never return database error messages, stack traces, or internal server paths in HTTP responses to clients.

## Verification and evidence requirements

- Every reported vulnerability must include exact file path and line numbers as evidence.
- An explicit attack scenario must be described showing how an external actor exploits the weakness.
- The remediation must include a verified code snippet or configuration change.
- Never state "the application is completely secure" because no obvious vulnerability was spotted. State explicitly which surfaces were audited and what limitations existed.

## Expected outputs and deliverables

- **Security Audit Report:** Comprehensive assessment detailing audited attack surfaces and methodology.
- **Vulnerability Findings List:** Structured findings categorized by severity, citing code evidence, attack scenarios, and remediations.
- **Remediation Pull Request / Code Patches:** Focused security fixes addressing confirmed vulnerabilities.
- **Security Invariants Checklist:** Set of automated rules or tests added to prevent regressions.

## Risks, boundaries and failure modes

- **Destructive Testing Prohibition:** Do not perform denial-of-service tests, mass database modifications, or destructive exploits on production or shared environments.
- **False Sense of Security:** Auditing three files does not make an application safe; always state the scope and boundaries of the audit.
- **Secret Exposure:** Never output discovered real credentials or API keys into public logs, issue trackers, or documentation.

## Progressive disclosure references

For standardized vulnerability checklists and classification templates:

- [Security Auditing Checklist: Threat Modeling and OWASP Verification](./references/security-audit/vulnerability-assessment-checklist.md)
