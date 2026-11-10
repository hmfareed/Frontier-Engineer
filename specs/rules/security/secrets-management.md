---
id: secrets-management
name: Secrets Management Standards
category: security
triggerType: glob
globs: "**/*.{env*,json,yaml,yml,conf,config,ini,toml}"
description: Standards for preventing secret leaks, environment variable hygiene, key rotation, and secure credential handling.
priority: 10
enforcementLevel: mandatory
platformConfig: {}
---

# Secrets Management Standards Rule

## Purpose

The Secrets Management Standards rule establishes mandatory safeguards to prevent the disclosure, exposure, or mishandling of sensitive credentials, API keys, private certificates, and authentication tokens across source code and configuration files.

## Scope and applicability

Applies to all configuration files, environment definitions, container manifests, CI/CD pipeline definitions, test fixtures, and source code handling credentials.

## Core standards

- **Externalized Credential Storage:** Keep all production secrets, API tokens, database passwords, and cryptographic keys out of source code. Inject them at runtime using environment variables, cloud secret managers (AWS Secrets Manager, Google Secret Manager, HashiCorp Vault), or secure CI/CD secret stores.
- **Example Environment Templates:** Maintain clean, sanitized `.env.example` templates documenting all required environment variables with dummy or descriptive placeholder values.
- **Gitignore Protection:** Ensure all sensitive configuration files (`.env`, `.env.local`, `*.pem`, `*.key`, `id_rsa`, credentials files) are explicitly listed in `.gitignore`.
- **Log Sanitization:** Ensure logging frameworks and error formatters scrub or redact authorization headers, tokens, secrets, and query parameters before writing to log streams or telemetry pipelines.
- **Immediate Rotation Protocol:** If a secret is ever accidentally exposed in code or commits, consider it permanently compromised; revoke, rotate, and reissue the secret immediately rather than merely deleting the file or rewriting commit history.

## Invariants and prohibitions

- **Prohibited:** Committing hardcoded API keys, database passwords, private keys, or webhook secrets to any branch of the repository.
- **Prohibited:** Pasting real secrets into issue descriptions, pull request comments, task artifacts, or public documentation.
- **Prohibited:** Bypassing pre-commit secret detection hooks (`detect-secrets`, `gitleaks`, `trufflehog`) using `--no-verify`.
- **Prohibited:** Storing production credentials in local development test files or test fixtures.

## Verification criteria

- Run automated secret scanning tools (`gitleaks`, `git-secrets`, or regex scans) across the entire git commit history with zero findings.
- Verify that `.gitignore` contains entries preventing tracking of local environment and secret files.
- Inspect application logs under authentication and transaction flows to verify that tokens and secrets are masked.
