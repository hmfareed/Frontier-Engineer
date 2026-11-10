# Security policy

Frontier Engineer operates under **least privilege**. The system is designed to be capable without becoming dangerously autonomous. This document defines the foundation policies; Phase 6 adds enforcement through supported lifecycle hooks.

## Reporting a vulnerability

Do not open a public issue. Report privately to the repository maintainers and include the affected component, reproduction steps, impact, and suggested remediation. No credentials or production data should be included in a report.

## Secret management

Agents and contributors must never:

- Hardcode credentials, API keys, tokens, or passwords.
- Commit `.env` files or private key material.
- Print secrets to logs, artifacts, or reports.
- Send credentials to untrusted services.
- Invent credentials when configuration is missing.

Use environment variables, the Antigravity MCP `variables` mechanism, or an approved secrets manager. `npm run validate` fails the build if an `.env` file, PEM private key, or a literal bearer token in `mcp_config.json` is detected. This check is a guardrail, not a full secret scanner.

## Environment variables

Every required variable must be documented before use. Prefer `${VARIABLE_NAME}` placeholders over literal values. Undocumented variables must not be introduced. `.env.example` is the only environment file permitted in the repository.

## Sensitive file handling

Treat the following as sensitive: `.env*`, private keys, credential stores, OAuth token caches, transcripts, and workspace artifacts. Do not copy them into reports, plugin assets, or commit history. When inspecting a repository, read only what the task requires.

## Dependency security

- Development dependencies are pinned through `package-lock.json`.
- Do not add runtime dependencies without a justified supporting requirement.
- Review the source and maintainer reputation of any MCP server before enabling it.
- Update dependencies deliberately and re-run `npm run verify` plus `agy plugin validate --strict .`.

## Destructive command approval

Human confirmation is required before: deleting important files, dropping database tables, running destructive migrations, force-pushing, rewriting shared history, or executing unrestricted shell commands. An approval request must state the operation, why it is needed, affected resources, reversibility and rollback, and the risks.

## Production deployment approval

Deployments to production, changes to production infrastructure, and credential rotation always require explicit human approval. Frontier Engineer never auto-deploys.

## Database migration safety

Migrations must be reviewed for data loss, reversibility, locking behavior, and rollback. Never drop or rename a column in a single deployment when an expand-and-contract approach is available. Migration tests must be executed before reporting success.

## Authentication and authorization review

When building or reviewing applications, verify identity validation, server-side role enforcement, resource ownership, session expiration, token validation, password storage, account recovery, and access revocation. Never trust client-provided identity or roles.

## External tool permissions

Every MCP integration is optional and independently configurable. Review source authenticity, permissions, network access, data exposure, command execution, write operations, and credential handling before enabling a server. Do not grant unrestricted access because a tool is convenient. GitHub write operations require explicit approval.

## Least-privilege MCP configuration

When `mcp_config.json` is introduced in Phase 5:

- Prefer read-only servers and explicit `enabledTools` allowlists over blanket access.
- Declare credentials through `variables` so installation prompts the user rather than embedding secrets.
- Prefer remote HTTPS endpoints or cross-platform Node.js `stdio` scripts.
- Use `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` instead of hardcoded absolute paths.
- Leave unused servers `"disabled": true`.

## Verification claims

Never report that a security control works without executing it. Never fabricate test results, successful installation, or supported APIs. Report skipped and blocked checks explicitly.
