# Changelog

All notable changes to Frontier Engineer are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.6.3] - 2026-11-11

Final Host Verification Closure & Security Acceptance (Phase 6.1.2) and Final Evidence Reconciliation & Release Acceptance (Phase 6.1.3).

### Added

- **Final Evidence Reconciliation (Phase 6.1.3)**:
  - Formally differentiated five tiers of verification evidence: automated schema/unit tests, direct handler tests, subprocess integration tests, live Antigravity host tests, and blocked tests.
  - Reconciled PostgreSQL MCP interception evidence: explicitly classified host-level interception as **NOT VERIFIED**, preventing the conflation of subprocess integration tests (HOOK-30, HOOK-34, HOOK-35) with live host execution.
  - Documented the three levels of `force_ask` confirmation: classifier emission (Level 1: Verified), simulated decline (Level 2: Verified), and interactive host UI prompt bypassing cached Always Allow (Level 3: Blocked, HOOK-21 & HOOK-31).
  - Executed official strict CLI validation: `agy plugin validate --strict .` with Antigravity CLI v1.5.0, confirming zero findings across 10 skills, 6 agents, 14 rules, 6 hooks, and 5 MCP servers with exit code 0.
- **Explicit MCP Tool Capability Registration (`TRUSTED_MCP_TOOLS`)**:
  - Bound trusted MCP tools to their authoritative MCP server identifiers (`database` for `postgres_mcp_query`, `science_biomolecular_structure_viewer_mcp` for `get_state`).
  - Added unexpected server detection: known tools registered under unverified or rogue servers are rejected from trusted classification and escalated to `force_ask` with `semanticClass: "unknown"`.
- **Adversarial Tool Name & Mutation Protections**:
  - Expanded `DESTRUCTIVE_TOOL_NAME_PATTERN` to flag execution tokens (`execute`, `eval`, `exec`), guaranteeing tools like `read_and_execute` and `list_and_remove` escalate to `force_ask` as `destructive`.
  - Expanded `PROHIBITED_DATABASE_MUTATIONS` to intercept `DELETE FROM` statements alongside `DROP` and `TRUNCATE`.
- **Dispatcher Failure Matrix (HOOK-36 through HOOK-45)**:
  - Enforced fail-closed behavior across a comprehensive 10-condition failure matrix: empty stdin, invalid JSON, missing tool name, invalid arguments, classifier exceptions, circular output serialization, logging failures, runtime timeouts, stdout emission limitations, and malformed MCP payloads.
  - Hardened runtime payload validator (`validateEventPayload`) in `scripts/hooks/runtime/validation.ts` to strictly validate `toolCall.name`, argument shapes, and encapsulated MCP properties (`ToolName`, `Arguments`, `ServerName`).
- **Extended Acceptance Suite (HOOK-01 through HOOK-45)**:
  - Expanded `scripts/run-live-acceptance.ts` from 30 to 45 structured acceptance tests covering Acceptances A, B, C, and D.
  - Verified host-visible tool identity formats using empirical evidence from live Antigravity host invocations (`call_mcp_tool` with capitalized `ServerName`, `ToolName`, `Arguments`).
  - Documented live host `force_ask` verification (HOOK-31) honestly as `BLOCKED` due to headless external browser Google OAuth constraints in `agy.exe -p`.

### Changed

- **Version Bump & Synchronization**:
  - Synchronized version `0.6.3` across `package.json`, `package-lock.json`, `plugin.json`, `specs/hooks/hook-registry.md`, `README.md`, `docs/01-PROJECT-OVERVIEW.md`, `docs/adr/ADR-006-lifecycle-hooks-architecture.md`, and integration test assertions.

## [0.6.2] - 2026-11-11

Final Host-Level Security Acceptance & Conceptual Semantic Classification (Phase 6.1.1).

### Added

- **Conceptual Semantic Capability Classification**:
  - Replaced heuristic prefix-based automatic approval with explicit semantic categorization: `trusted_read_only`, `workspace_read`, `workspace_write`, `external_side_effect`, `destructive`, and `unknown`.
  - Added an explicit `TRUSTED_READ_ONLY_TOOLS` whitelist for known read-only endpoints (`read_file`, `view_file`, `search_marketplace`, `list_plugin_accounts`, `read_resource`, `list_resources`, `grep`, `glob`).
  - Added detection and override for misleading or disguised tool names: operations matching `DESTRUCTIVE_TOOL_NAME_PATTERN` (`query_delete_records`) or `EXTERNAL_SIDE_EFFECT_PATTERN` (`fetch_and_publish`) are escalated to `force_ask` even if they carry a read-like prefix.
  - Conservative gating for unvetted tools: any tool outside known trusted sets defaults to `semanticClass: "unknown"` and requires interactive confirmation via `force_ask`.
- **Fail-Closed Hook Dispatcher with Exit Code 0**:
  - Hardened `scripts/hooks/runtime/dispatcher.ts` and `scripts/hooks/runtime/output.ts` to guarantee that unhandled exceptions, circular JSON errors, and schema failures emit a valid protocol denial response (`{"decision": "deny", "reason": "..."}`) to stdout and terminate with process exit code 0.
  - Prevents Antigravity from treating non-zero handler crashes as tool-level failures that fail open into unmonitored execution.
- **Extended Acceptance Suite (HOOK-01 through HOOK-30)**:
  - Extended live acceptance harness in `scripts/run-live-acceptance.ts` to 30 structured tests, categorizing each test by evidence type (`Unit`, `Integration`, `Direct handler`, `Live Antigravity`).
  - Added adversarial scenarios HOOK-SCEN-24 (`query_delete_records`), HOOK-SCEN-25 (`fetch_and_publish`), and HOOK-SCEN-26 (`search_marketplace`).
  - Documented Acceptance Test A (`force_ask` confirmation bypass test) as `BLOCKED` with empirical evidence regarding headless external browser OAuth constraints in `agy.exe -p`.
  - Verified Acceptance Test B (MCP interception across direct, prefixed, and encapsulated tool names).

### Changed

- **Version Bump & Synchronization**:
  - Synchronized version `0.6.2` across `package.json`, `package-lock.json`, `plugin.json`, `specs/hooks/hook-registry.md`, and integration test assertions.
- **SQL Mutation Regex Hardening**:
  - Broadened `TRUNCATE` detection to match both `TRUNCATE TABLE` and shorthand `TRUNCATE <table_name>`.

## [0.6.1] - 2026-11-11

Antigravity Tool Coverage Correction & Permission Enforcement (Phase 6.1).

### Added

- **Native Antigravity Tool Coverage**:
  - Implemented normalized tool call representation (`normalizeToolCall`) in `scripts/hooks/lib/event-context.ts` supporting official native Antigravity file operations: `view_file` (with `AbsolutePath`), `write_to_file` (with `TargetFile`, `Content`), `replace_file_content` (with `TargetFile`), and `multi_replace_file_content` (with `TargetFile`).
  - Standardized argument extraction across heterogeneous parameter naming conventions (`AbsolutePath`, `TargetFile`, `Path`, `CommandLine`, `Arguments`).
  - Added support for direct MCP tool execution inspection (`postgres_mcp_query`, `postgres_mcp_modify`, `postgres_mcp_bulk_load_csv`).
- **Conservative Unrecognized Tool Gating**:
  - Implemented safe classification for unknown or unvetted tools: non-read-only unknown tools automatically escalate to `force_ask` rather than being auto-approved.
  - Safe read-only patterns (`read_*`, `get_*`, `list_*`, `fetch_*`, `view_*`, `search_*`) are permitted when their path arguments do not access sensitive secrets.
- **Extended Adversarial Evaluation & Live Acceptance Scenarios**:
  - Expanded `specs/evaluation/hook-scenarios.json` to 23 scenarios covering native Antigravity tools (`view_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`) and unvetted tools.
  - Extended live acceptance suite in `scripts/run-live-acceptance.ts` from 10 to 20 scenarios (HOOK-01 through HOOK-20), testing all native file operations, credential overwrite protections, and permission broadening.

### Changed

- **Global Matcher Implementation (Approach B)**:
  - Transitioned `frontier-pre-tool-safety` (`PreToolUse`) and `frontier-post-tool-audit` (`PostToolUse`) to global matcher `*` across canonical specifications (`specs/hooks/pre-tool-use.md`, `specs/hooks/post-tool-use.md`, `specs/hooks/hook-registry.md`) and regenerated `hooks.json`.
  - Eliminates potential security bypasses caused by mismatched tool aliases or newly added host tools.
- **Permission Enforcement with `force_ask`**:
  - Replaced `ask` with `force_ask` for high-risk operations (`git clean -fdx`, `git reset --hard`, `chmod 777`, `icacls`, administrative privilege escalation) to bypass cached "Always Allow" permissions and guarantee fresh developer awareness.
- **Credential Protection Across Write/Edit Operations**:
  - Strengthened `classifyFilePath` to prohibit writing or editing sensitive credential files (`.env`, `id_rsa`, `id_ed25519`, `credentials.json`, `.key`, `.pem`, `.pfx`), in addition to reading.
- **Documentation & Architecture Records**:
  - Added Phase 6.1 Addendum to `docs/adr/ADR-006-lifecycle-hooks-architecture.md`.
  - Updated documentation Parts 28–33 (`docs/28-HOOKS-ARCHITECTURE.md` through `docs/33-HOOKS-PORTABILITY.md`) reflecting global matching and `force_ask` enforcement.
  - Bumped version to `0.6.1` across `package.json`, `package-lock.json`, `plugin.json`, `specs/hooks/hook-registry.md`, and repository tests.

## [0.6.0] - 2026-11-11

Lifecycle Hooks System & Execution-Time Safeguards (Phase 6).

### Added

- **Canonical Lifecycle Hooks Architecture**:
  - Authored canonical hook specifications under `specs/hooks/` for six official Antigravity lifecycle events: `frontier-session-init` (`SessionStart`), `frontier-pre-tool-safety` (`PreToolUse`), `frontier-post-tool-audit` (`PostToolUse`), `frontier-engineering-context` (`PreInvocation`), `frontier-invocation-audit` (`PostInvocation`), and `frontier-session-stop` (`Stop`).
  - Authored central `specs/hooks/hook-registry.md` mapping hook identifiers, lifecycle events, matchers, timeouts, and cross-platform compatibility.
  - Authored comprehensive `specs/hooks/hook-security-model.md` defining operation permissions, fail-closed vs fail-open policies, threat matrix, and audit data bounds.
- **Hook Validation Schemas**:
  - Created `schemas/canonical-hook.schema.json` validating canonical hook frontmatter and required structure.
  - Created `schemas/hook-registry.schema.json` validating the canonical hook registry.
  - Created `schemas/hook-evaluation-scenarios.schema.json` validating the adversarial evaluation dataset.
- **Code Generation & Drift Checking**:
  - Created `scripts/generate-antigravity-hooks.ts` and `scripts/lib/canonical-hooks.ts` compiling canonical hook policies into official loader-visible `<plugin-root>/hooks.json`.
  - Added `npm run generate:hooks` and integrated hook drift detection directly into `scripts/validate.ts`.
- **Modular TypeScript Hook Runtime**:
  - Built minimal, high-performance runtime under `scripts/hooks/`:
    - `runtime/dispatcher.ts`: Central CLI router handling stdin, validation, routing, stderr diagnostics, and protocol emission.
    - `runtime/input.ts`: Bounded stdin reader (10 MB cap) with timeout and safe JSON parsing.
    - `runtime/output.ts`: Protocol emitter guaranteeing strict stdout JSON serialization and stderr-only logging.
    - `runtime/logger.ts`: Sanitized JSONL audit logger with bounded file rotation (5 MB cap, 3 backups).
    - `runtime/validation.ts`: Runtime schema validation per lifecycle event.
    - `runtime/security.ts`: Deterministic safe fallback resolver implementing fail-closed (`PreToolUse`) and fail-open policies.
    - `lib/command-classifier.ts`: Multi-category tool call and shell command classifier (destructive filesystem, secret printing/exfiltration, dangerous permissions, database DDL).
    - `lib/secret-redactor.ts`: Recursive secret redaction engine for PEM keys, GitHub tokens, AWS keys, Sentry tokens, Bearer tokens, and connection strings.
    - `lib/workspace-validator.ts`: Workspace directory boundary checker and project structure inspector.
    - `lib/event-context.ts`: Event payload extraction and correlation normalizer.
    - Handlers for all six lifecycle events under `scripts/hooks/handlers/`.
- **Comprehensive Test Suite & Evaluation Scenarios**:
  - 15 adversarial evaluation scenarios in `specs/evaluation/hook-scenarios.json` covering normal commands, destructive filesystem commands, git clean, secret reads, exfiltration, database mutations, malformed payloads, timeouts, crashes, disk failures, repeated turns, and unicode Windows paths.
  - Unit tests: `tests/unit/canonical-hooks.test.ts`, `canonical-hooks-schema.test.ts`, `hook-generator.test.ts`, `hook-security.test.ts`, `hook-input.test.ts`, `hook-output.test.ts`, `hook-redaction.test.ts`, `hook-evaluation.test.ts`.
  - Integration tests: `tests/integration/hook-runtime.test.ts`, `hook-events.test.ts`, `hook-windows-compatibility.test.ts`.
  - Live Antigravity acceptance suite: `scripts/run-live-acceptance.ts` verifying all 10 acceptance criteria (HOOK-01 through HOOK-10) in a disposable workspace.
- **Documentation & Architectural Decision Records**:
  - Authored documentation Parts 28–33: `docs/28-HOOKS-ARCHITECTURE.md`, `docs/29-HOOKS-SPECIFICATIONS.md`, `docs/30-HOOKS-SECURITY.md`, `docs/31-HOOKS-RUNTIME.md`, `docs/32-HOOKS-TESTING.md`, `docs/33-HOOKS-PORTABILITY.md`.
  - Authored `docs/adr/ADR-006-lifecycle-hooks-architecture.md`.
  - Updated `docs/README.md`, `README.md`, `docs/01-PROJECT-OVERVIEW.md`, and `docs/20-REPOSITORY-STRUCTURE.md`.

### Changed

- Updated all six canonical agent specifications (`specs/agents/*.md`) and regenerated adapters (`agents/*.md`) incorporating hook execution safeguard awareness, pre-tool denial respect, and prohibition of bypass workarounds.
- Updated `tests/integration/repository.test.ts` to assert presence and validity of `hooks.json` and index all Phase 6 documents.
- Bumped version to `0.6.0` across `package.json`, `package-lock.json`, `plugin.json`, `specs/hooks/hook-registry.md`, and repository tests.

## [0.5.3] - 2026-11-11

PostgreSQL MCP Tool Allowlisting & Three-Tier Boundary Security Acceptance (Phase 5.1.2).

### Added

- Antigravity host-level tool allowlist (`enabledTools`) configured for PostgreSQL database integration in `mcp_config.json` and `mcp_config.example.json`, restricting exposed tools to exactly 8 approved inspection tools (`postgres_mcp_query`, `postgres_mcp_db_context`, `postgres_mcp_connect`, `postgres_mcp_disconnect`, `postgres_mcp_list_connection_profiles`, `postgres_mcp_list_databases`, `postgres_mcp_get_server_capabilities`, `postgres_mcp_get_metrics_group`).
- Canonical schema extension in `schemas/canonical-integration.schema.json` supporting `toolFiltering: "allowlist"`, enabling deterministic compilation of Antigravity host allowlists directly from platform-independent specifications.
- Comprehensive security evaluation and exclusion of `postgres_mcp_describe_csv` documented in `specs/integrations/database/capabilities.md` and `security.md`, mitigating local filesystem path traversal and arbitrary file inspection risks.
- Five new regression tests in `tests/unit/integration-security.test.ts` verifying:
  - Non-empty `enabledTools` allowlist containing only approved tool names.
  - Absence of destructive, external-side-effect, and filesystem tools.
  - Strict validator rejection (`prohibited-database-tool`, `unapproved-database-tool`, `invalid-database-tool-permission`) on any attempt to introduce unapproved tools or non-read-only permission classes.
  - Complete isolation ensuring other integrations (`github`, `context7`, `playwright`, `sentry`) do not inherit `enabledTools`.
  - Invariant that database configurations remain disabled by default (`disabled: true`).
- Phase 5.1.2 Addendum in `docs/adr/ADR-005-mcp-integration-architecture.md` and updated configuration reference in `docs/24-MCP-CONFIGURATION.md`.

### Changed

- Updated `specs/integrations/database/integration.md` to declare `toolFiltering: "allowlist"` and strictly contain the 8 approved tools in its canonical tool definitions.
- Updated `scripts/test-mcp-runtime.ts` to test and report all three independent security boundaries: Control 1 (Antigravity Host Filtering: 8 exposed vs 5 excluded), Control 2 (MCP Profile Mode: `access_mode: ro`), and Control 3 (PostgreSQL Engine: 18/18 psql assertions passed + transaction boundary denial).
- Bumped project version to `0.5.3` across `package.json`, `plugin.json`, `specs/integrations/integration-registry.md`, and repository tests.

## [0.5.2] - 2026-11-11

Live PostgreSQL MCP Verification, Database Security Audit & Runtime Remediation (Phase 5.1.1).

### Added

- Automated live PostgreSQL 18.6 security audit executed against an ephemeral cluster in `scripts/test-mcp-runtime.ts`, verifying 18/18 security assertions covering connection limits, query timeouts, table and view read access, schema creation denials, and DDL/DML mutation rejections.
- Live `@microsoft/postgres-mcp@0.3.0 run` stdio JSON-RPC runtime acceptance test verifying protocol handshake (`2024-11-05`), full 13-tool discovery, connection using the restricted `frontier_readonly` role, permitted `SELECT` query execution, and database-level transaction read-only denial on mutations.
- Phase 5.1.1 Addendum in `docs/adr/ADR-005-mcp-integration-architecture.md` detailing the live PostgreSQL MCP verification, actual 13-tool catalogue, Sentry auth token migration, and Playwright isolation clarifications.
- Expanded automated test coverage in `tests/unit/integration-security.test.ts` (11 tests) and `tests/unit/integration-registry.test.ts` (5 tests) enforcing official provider packages, mandatory arguments (`run`, `--read-only`, `--headless`, `--isolated`), token specifications, and lifecycle consistency.

### Changed

- Corrected Microsoft PostgreSQL MCP launch command across canonical specifications, documentation, and adapter configuration to include the mandatory `run` subcommand (`npx -y @microsoft/postgres-mcp@0.3.0 run`).
- Documented the verified 13-tool catalogue for `@microsoft/postgres-mcp@0.3.0` in `specs/integrations/database/integration.md` and `capabilities.md`, distinguishing inspection tools from excluded mutating tools (`postgres_mcp_modify`, `postgres_mcp_bulk_load_csv`, `postgres_mcp_add_connection`, `postgres_mcp_remove_connection`).
- Updated PostgreSQL database integration lifecycle status to `runtime_tested` following successful live stdio JSON-RPC handshake, tool discovery, and mutation denials.
- Canonicalized Sentry authentication environment variable from `SENTRY_ACCESS_TOKEN` to `SENTRY_AUTH_TOKEN` per current official `@sentry/mcp-server` documentation.
- Clarified Playwright isolation documentation in `specs/integrations/playwright/integration.md` and `security.md`, defining `--isolated` as in-memory `BrowserContext` profile isolation (cookies, storage, history) rather than host operating system containerization.
- Verified GitHub read-only configuration (`--read-only`) and documented required fine-grained PAT scopes (`Contents: Read`, `Issues: Read`, `Pull requests: Read`, `Metadata: Read`) in `specs/integrations/github/security.md`.
- Pinned exact provider versions across all integrations: `ghcr.io/github/github-mcp-server:v2.1.0`, `@upstash/context7-mcp@4.6.0`, `@playwright/mcp@0.0.85`, `@sentry/mcp-server@0.49.0`, and `@microsoft/postgres-mcp@0.3.0`.
- Bumped project version to `0.5.2` across `package.json`, `plugin.json`, and `specs/integrations/integration-registry.md`.

### Known limitations

- External credential-dependent integrations (`github`, `sentry`) remain accurately classified as `BLOCKED` in the runtime test harness when host credentials (`GITHUB_PERSONAL_ACCESS_TOKEN`, `SENTRY_AUTH_TOKEN`) or Docker daemon are absent.

## [0.5.1] - 2026-11-11

MCP Provider Verification, Correction & Runtime Hardening (Phase 5.1).

### Added

- Controlled live runtime acceptance test harness (`scripts/test-mcp-runtime.ts`) exercising MCP server subprocesses via JSON-RPC 2.0 stdio handshakes and tool discovery.
- Empirical test suite additions banning legacy deprecated packages (`@modelcontextprotocol/server-*`) from runtime arguments across all canonical integrations.
- Ten mandatory defense-in-depth database invariants (`specs/integrations/database/security.md`) and a formal PostgreSQL provisioning script enforcing least-privilege boundaries (read-only user, no schema ownership, no DDL/DML, 5,000ms timeout, connection limit 2).
- Formal 5-tier permission enforcement matrix (Server, Host, Provider/Database, Behavioral Rules, Human Approval) documented across all integration security specifications.
- Phase 5.1 Provider Corrections Addendum in `docs/adr/ADR-005-mcp-integration-architecture.md` and verification record in `docs/27-OFFICIAL-FORMAT-VERIFICATION.md`.

### Changed

- Replaced deprecated `@modelcontextprotocol/server-github` with official `github/github-mcp-server` enforcing `--read-only=true` (server-side mutating tool rejection) and `--toolsets=context,issues,pull_requests,repos`.
- Pinned Context7 integration to Upstash `@upstash/context7-mcp` with exact verified tool names `resolve-library-id` and `query-docs`; lifecycle updated to `runtime_tested` following successful live stdio JSON-RPC handshake.
- Replaced community/deprecated Playwright packages with official `@playwright/mcp@latest` enforcing `--headless` and `--isolated` (in-memory profiles with zero access to personal developer browser state); lifecycle updated to `runtime_tested` following successful live stdio JSON-RPC handshake and 25-tool discovery.
- Replaced `@modelcontextprotocol/server-sentry` with official `@sentry/mcp-server` (`https://github.com/getsentry/sentry-mcp`) requiring `SENTRY_ACCESS_TOKEN`.
- Evaluated PostgreSQL MCP alternatives (`@microsoft/postgres-mcp` vs `antonorlov/mcp-postgres-server`), standardizing on `@microsoft/postgres-mcp` with `POSTGRES_MCP_CONNECTION_STRING` under 10 strict invariants.
- Regenerated Antigravity MCP adapter `mcp_config.json` and `mcp_config.example.json` with zero drift.
- `package.json` and `plugin.json` bumped to `0.5.1`.

### Known limitations

- Live runtime invocation of GitHub, Sentry, and PostgreSQL requires external user credentials (`GITHUB_PERSONAL_ACCESS_TOKEN`, `SENTRY_ACCESS_TOKEN`, `POSTGRES_MCP_CONNECTION_STRING`) or running Docker daemon; accurately classified as `BLOCKED` with empirical evidence in the runtime test harness.

## [0.5.0] - 2026-11-10

Secure MCP integration architecture (Phase 5).

### Added

- Secure Model Context Protocol (MCP) integration subsystem connecting Frontier Engineer to external tools across 5 categories: GitHub (`repository`), Context7 (`documentation`), Playwright (`browser_testing`), Sentry (`observability`), and PostgreSQL (`database`).
- Five canonical integration specifications under `specs/integrations/` (`github`, `context7`, `playwright`, `sentry`, `database`), each with a 3-tier modular structure: `integration.md`, `capabilities.md`, and `security.md`.
- Canonical schemas: `schemas/canonical-integration.schema.json` and `schemas/integration-registry.schema.json`.
- Central machine-readable integration registry at `specs/integrations/integration-registry.md` declaring all integrations, agent mappings, optionality, and fallback behaviors.
- Five-tier capability-based permission model (`read_only`, `reversible_write`, `external_side_effect`, `destructive`, `sensitive_data_access`) with human-in-the-loop gates for destructive actions and sensitive data access.
- TypeScript generator (`scripts/generate-antigravity-integrations.ts`) compiling canonical specifications into Antigravity adapter `mcp_config.json` (disabled by default, inheriting host environment) and `mcp_config.example.json`.
- Strict drift detection in `scripts/lib/canonical-integrations.ts` ensuring config files remain in sync with canonical specs.
- Official format verification with `agy plugin validate --strict .` recognizing 10 skills, 6 agents, 14 rules, and 5 MCP servers with zero warnings or errors.
- New architecture documentation: `docs/21-MCP-ARCHITECTURE.md`, `docs/22-MCP-INTEGRATIONS.md`, `docs/23-MCP-SECURITY.md`, `docs/24-MCP-CONFIGURATION.md`, `docs/25-MCP-PORTABILITY.md`, `docs/26-MCP-OPERATIONS.md`, and `docs/adr/ADR-005-mcp-integration-architecture.md`.
- Comprehensive automated test suite: `tests/unit/canonical-integrations-schema.test.ts`, `tests/unit/canonical-integrations.test.ts`, `tests/unit/integration-registry.test.ts`, and `tests/unit/integration-security.test.ts`.

### Changed

- Renumbered `docs/24-OFFICIAL-FORMAT-VERIFICATION.md` to `docs/27-OFFICIAL-FORMAT-VERIFICATION.md` to accommodate MCP architecture documentation block (Parts 21–26); updated all references across repository.
- `plugin.json` and `package.json` bumped to `0.5.0`.
- Coordinator and specialist agents updated with selective MCP capability mappings.
- Validation script and test runner updated to verify canonical integrations and drift.

### Known limitations

- External MCP servers require user installation of respective npm packages and optional API tokens.
- Integrations are shipped disabled by default (`"disabled": true`); developers must enable them selectively in `mcp_config.json`.
- Non-Antigravity adapters (Claude Code, Codex, Cursor) are specified in registry and documentation but not generated.

## [0.4.0] - 2026-11-10

Modular engineering rules system (Phase 4).

### Added

- Fourteen engineering rules: one global always-on foundation rule (`rules/AGENTS.md`) and thirteen modular rules across seven engineering categories (`engineering`, `frontend`, `backend`, `database`, `security`, `testing`, `performance`).
- Canonical platform-independent rule specifications under `specs/rules/` validated against `schemas/canonical-rule.schema.json`, each enforcing five mandatory sections (`Purpose`, `Scope and applicability`, `Core standards`, `Invariants and prohibitions`, and `Verification criteria`).
- A TypeScript generator (`scripts/generate-antigravity-rules.ts`) compiling canonical specifications into flat Antigravity-compatible files under `rules/<id>.md` and `rules/AGENTS.md`.
- Strict drift detection in `scripts/lib/canonical-rules.ts` checking frontmatter, normalized body content, and absence of unexpected or missing rule files.
- Official format verification with `agy plugin validate --strict .` recognizing 10 skills, 6 agents, and 14 rules with zero warnings or errors.
- New documentation: `docs/15-RULES-ARCHITECTURE.md`, `docs/16-RULE-SPECIFICATIONS.md`, `docs/17-RULE-ACTIVATION.md`, `docs/18-RULE-PRIORITY-AND-CONFLICTS.md`, `docs/19-RULE-PORTABILITY.md`, and `docs/adr/ADR-004-rules-system.md`.
- Comprehensive test coverage in `tests/unit/canonical-rules-schema.test.ts` and `tests/unit/canonical-rules.test.ts`.

### Changed

- `docs/15-REPOSITORY-STRUCTURE.md` moved to `docs/20-REPOSITORY-STRUCTURE.md` to cleanly accommodate the Rules System documentation block (Parts 15–19); all incoming links updated.
- `plugin.json` and `package.json` bumped to `0.4.0`.
- Validation script and test runner updated to verify canonical rules and generated adapters.

### Known limitations

- Path-triggered glob rules and model-decision rules depend on Antigravity runtime evaluation during live user sessions.
- Non-Antigravity rule adapters (Claude Code, Codex, Cursor) remain documented canonical targets but are not compiled.

## [0.3.0] - 2026-11-10

Portable engineering skills system (Phase 3).

### Added

- Ten platform-independent canonical skill specifications in `specs/skills/`, each containing ten mandatory sections, structured frontmatter, clear purpose, activation triggers, non-activation guidelines, operating procedures, engineering standards, verification requirements, and progressive disclosure references.
- Ten deep reference guides in `specs/skills/references/` providing concrete decision frameworks, trade-off matrices, vulnerability assessment checklists, code review rubrics, interaction state specifications, and benchmarking procedures.
- A TypeScript generator (`scripts/generate-antigravity-skills.ts`) that compiles canonical skills into runtime Antigravity adapters in `skills/<skill_name>/SKILL.md` with verified frontmatter (`name` and `description`) and synchronizes references.
- Twenty skill evaluation scenarios in `specs/evaluation/skill-scenarios.json` and schema `schemas/skill-evaluation-scenarios.schema.json` with a 6-dimension rubric. Status locked to `defined`; no scores claimed.
- Skill validation engine in `scripts/lib/canonical-skills.ts` enforcing schema conformity, required sections, and drift detection between canonical specs and generated adapters.
- New documentation: `docs/09-SKILLS-ARCHITECTURE.md`, `docs/10-SKILL-SPECIFICATIONS.md`, `docs/11-SKILL-ACTIVATION.md`, `docs/12-SKILL-AGENT-INTEGRATION.md`, `docs/13-SKILL-PORTABILITY.md`, and `docs/adr/ADR-003-skills-system.md`.
- Comprehensive test coverage in `tests/unit/canonical-skills-schema.test.ts`, `tests/unit/canonical-skills.test.ts`, and `tests/unit/skill-evaluation.test.ts`.

### Changed

- `docs/09-ENGINEERING-PRINCIPLES.md` moved to `docs/14-ENGINEERING-PRINCIPLES.md` to cleanly accommodate the Skills System documentation block (Parts 09–13); all incoming links updated.
- `plugin.json` and `package.json` bumped to `0.3.0`.
- Validation script and test runner updated to verify both canonical agents and canonical skills.

### Known limitations

- Runtime skill activation and multi-agent coordination during live user sessions have not been tested.
- Non-Antigravity adapters (Claude Code, Codex, Cursor, Windsurf) are documented with requirements but remain explicitly NOT IMPLEMENTED.
- No behavioral evaluation scores have been assigned.

## [0.2.0] - 2026-11-10

Specialized agent system (Phase 2).

### Added

- Six platform-independent canonical agent specifications in `specs/agents/`, each with eleven mandatory sections and structured frontmatter.
- A TypeScript generator (`scripts/generate-antigravity-agents.ts`) that produces the six loader-visible `agents/*.md` files, with a `--check` mode enforced by `npm run validate`.
- A structured handoff and response contract: `specs/handoff-contract.md`, `specs/handoff-examples.json`, and `schemas/handoff.schema.json`.
- Nineteen evaluation scenarios and an eight-dimension rubric in `specs/evaluation/scenarios.json`, validated by `schemas/evaluation-scenarios.schema.json`. Status is locked to `defined`; no scores are assigned.
- Adapter registry and requirements documents for Antigravity (implemented) plus Claude Code, Codex, Cursor, and Windsurf (all explicitly NOT IMPLEMENTED).
- New documentation: `docs/04` through `docs/08`, plus `ADR-002`.
- Validator checks for canonical specs, generated-file freshness, adapter status claims, contract examples, evaluation definitions, and agent name/filename consistency.

### Changed

- `docs/06-ENGINEERING-PRINCIPLES.md` moved to `docs/09-ENGINEERING-PRINCIPLES.md` to free Part 06 for agent communication; all references updated.
- `plugin.json` and `package.json` bumped to `0.2.0`.

### Known limitations

- `tools` allowlists are not emitted. Official documentation conflicts on the default and warns that unmapped tool names can hang subagents; least privilege is enforced behaviourally instead.
- Runtime agent invocation, real delegation, and handoff round trips have not been tested.
- No adapter other than Antigravity is implemented or claimed to work.

## [0.1.0] - 2026-11-10

Foundation release (Phase 1). This is a development version, not the `1.0.0` product release described in the specification.

### Added

- `plugin.json` using the verified Antigravity plugin manifest schema, plus a bundled logo asset.
- Repository structure: `agents/`, `skills/`, `rules/`, `scripts/`, `schemas/`, `tests/`, `docs/`, `assets/`, `.github/workflows/`.
- Node.js/TypeScript toolchain configuration: `package.json`, `tsconfig.json`, Prettier, markdownlint-cli2, Vitest, `.gitignore`, `.gitattributes`.
- TypeScript validation utilities covering required files, JSON syntax, verified plugin/skill/agent/rule schemas, optional MCP and hooks configs, YAML frontmatter, component metadata, Markdown links, documentation indexing, config placement, and secret hygiene.
- Unit and integration tests with deliberately invalid fixtures.
- Documentation: project overview, technology stack, system architecture, engineering principles, repository structure, official format verification, and ADR-001.
- `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE`, and a CI validation workflow.
- A single always-on foundational rule at `rules/AGENTS.md`.

### Deferred

- The six specialized agents (Phase 2), ten skills (Phase 3), full rule set (Phase 4), MCP integrations (Phase 5), hooks (Phase 6), project intelligence and memory (Phase 7), evaluation suite (Phase 8), and release packaging (Phase 9/10).
