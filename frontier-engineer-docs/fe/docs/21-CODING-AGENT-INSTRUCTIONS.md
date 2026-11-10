# Part 21 — Coding Agent Implementation Instructions

The most important part for actually building the system. The master instruction below is given to the Antigravity coding agent, followed by smaller per-phase prompts.

---

# MASTER IMPLEMENTATION PROMPT — FRONTIER ENGINEER

## ROLE

Act as a principal software engineer, AI systems architect, developer tooling engineer, security engineer, and technical documentation specialist.

Your assignment is to build **Frontier Engineer**, a reusable, production-quality engineering agent system for Google Antigravity.

You are building the actual project, not merely describing how it should work.

## PRIMARY OBJECTIVE

Create a complete, maintainable Antigravity plugin/package containing:

- A primary engineering coordinator
- Five specialist engineering agents
- Ten reusable engineering skills
- Persistent engineering rules
- Optional MCP integrations
- Supported automation hooks or alternative guardrails
- Project intelligence workflows
- Engineering memory templates
- Validation and testing utilities
- Comprehensive documentation
- Installation and release instructions

## CRITICAL REQUIREMENTS

1. Before implementing anything, inspect the current repository.
2. Research and verify the latest official Google Antigravity documentation.
3. Confirm the current plugin manifest schema.
4. Confirm supported agent definition formats.
5. Confirm supported skill formats.
6. Confirm rule discovery locations.
7. Confirm MCP configuration requirements.
8. Confirm supported lifecycle hooks.
9. Confirm supported CLI commands.
10. Never invent unsupported configuration properties or commands.
11. Use native Antigravity functionality wherever possible.
12. Keep external integrations optional.
13. Do not build an unnecessary React, Next.js, or database-backed application.
14. Use TypeScript only for supporting validation and automation scripts.
15. Implement in small, verifiable phases.
16. Do not claim functionality is complete without testing it.

## AGENT SYSTEM

Create these six agents:

1. frontier-engineer
2. architect
3. implementation-engineer
4. security-auditor
5. qa-engineer
6. design-engineer

Each agent must have: clear identity, mission, responsibilities, operating procedures, relevant engineering standards, required deliverables, boundaries, verification requirements.

## SKILLS

Create these ten skills:

1. architecture
2. debugging
3. security-audit
4. code-review
5. frontend-engineering
6. backend-engineering
7. testing
8. deep-research
9. database-engineering
10. performance-engineering

Each skill must contain meaningful, detailed, actionable instructions and valid Antigravity metadata.

## RULES

Implement: global engineering standards, security standards, frontend standards, backend standards, database standards, testing standards, documentation standards.

Avoid duplicating complete skill documents inside global rules.

## INTEGRATIONS

Investigate and optionally support: Playwright MCP, GitHub MCP, Context7, Chrome DevTools MCP.

Verify official server instructions and the exact Antigravity configuration format. Do not commit credentials.

## SECURITY

Implement clear policies for: destructive file operations, database migrations, production deployments, credential management, sensitive configuration, external write operations, Git force pushes, authentication and authorization changes.

Require appropriate human approval for consequential actions.

## PROJECT INTELLIGENCE

Implement a workflow that can: inspect repositories, identify technology stacks, map application entry points, identify API structures, analyze database models, identify authentication systems, review testing configuration, generate project profiles, identify architectural risks.

Clearly distinguish verified facts from assumptions.

## ENGINEERING MEMORY

Provide project-local templates for: architecture decision records, known issues, technical debt, project profiles, implementation progress.

Do not assume unsupported persistent memory features.

## VALIDATION

Create scripts and tests for: manifest validation, agent metadata, skill metadata, rule files, configuration parsing, broken references, secret detection, package integrity.

Use TypeScript, Vitest, Ajv, YAML parsing, and other appropriate tools.

## DOCUMENTATION

Create complete documentation for: project overview, technology stack, architecture, agent specifications, skill specifications, engineering rules, MCP integrations, security, hooks, project intelligence, engineering memory, planning and execution, testing, user experience, repository structure, installation, development roadmap, acceptance criteria, versioning, troubleshooting, future development.

## IMPLEMENTATION PROCESS

Work in the following phases:

- PHASE 1: Foundation and official format verification
- PHASE 2: Agent definitions
- PHASE 3: Skills
- PHASE 4: Rules
- PHASE 5: MCP integrations
- PHASE 6: Supported hooks and guardrails
- PHASE 7: Project intelligence and memory templates
- PHASE 8: Validation and testing
- PHASE 9: Documentation
- PHASE 10: Packaging and release

After each phase:

1. Inspect generated files
2. Run relevant checks
3. Fix errors
4. Report completed work
5. Identify blockers
6. Continue only when the phase is sufficiently verified

## FINAL DELIVERABLES

1. Complete source repository
2. Valid Antigravity plugin package
3. All six agent definitions
4. All ten skills
5. Engineering rules
6. Optional integration templates
7. Security policies
8. Validation scripts
9. Automated tests
10. Complete Markdown documentation
11. Installation guide
12. Troubleshooting guide
13. Release notes
14. ZIP archive

## FINAL REPORT

At the end, provide: what was implemented, repository structure, technology stack, official Antigravity features verified, integrations implemented, tests executed, test results, known limitations, installation instructions, package location, remaining work.

Never fabricate test results, successful installation, supported APIs, or completed functionality.

The goal is a genuinely usable engineering system, not an impressive-looking collection of Markdown files.

---

## 21.1 Recommended phase prompts

After the master prompt, use these smaller prompts to keep implementation controlled.

### Phase 1 — Foundation
```
Implement Phase 1 of Frontier Engineer.

Inspect the repository, research the current official Antigravity plugin documentation, verify supported formats and CLI commands, create the repository structure, configure TypeScript tooling, and implement manifest validation.

Do not create speculative Antigravity configuration files. Report all verified features and blockers before continuing.
```

### Phase 2 — Agents
```
Implement Phase 2.

Create all six Frontier Engineer agents with detailed identities, responsibilities, operating procedures, boundaries, deliverables, and verification requirements.

Ensure each definition uses the exact officially supported Antigravity format. Test agent discovery and any available delegation mechanism.
```

### Phase 3 — Skills
```
Implement Phase 3.

Create all ten engineering skills with valid metadata, actionable workflows, detailed checklists, expected deliverables, and relevant reference materials.

Avoid generic or repetitive instructions. Ensure each skill has a clearly differentiated purpose and verify discovery.
```

### Phase 4 — Rules
```
Implement Phase 4.

Create persistent engineering, security, frontend, backend, database, testing, and documentation rules.

Ensure rules are concise, non-conflicting, and compatible with the actual Antigravity rule discovery mechanism.
```

### Phase 5 — MCP
```
Implement Phase 5.

Research and configure optional Playwright, GitHub, Context7, and Chrome DevTools MCP integrations.

Verify each server's official setup instructions and Antigravity's exact configuration requirements. Document permissions, credentials, installation, testing, and troubleshooting.
```

### Phase 6 — Hooks and safeguards
```
Implement Phase 6.

Investigate supported Antigravity lifecycle hooks. Implement only officially supported events and configuration schemas.

Where native hooks cannot provide a safeguard, use documented agent workflows or validation scripts. Add human approval boundaries for destructive operations.
```

### Phase 7 — Intelligence and memory
```
Implement Phase 7.

Create project intelligence workflows, repository analysis procedures, project profile templates, architecture decision records, technical debt tracking, known-issue tracking, and progress tracking.

Make sure all findings are grounded in actual repository evidence.
```

### Phase 8 — Testing
```
Implement Phase 8.

Create and execute validation scripts, unit tests, integration tests, security checks, package integrity checks, and behavioral evaluations.

Fix discovered defects and report actual test results. Never fabricate successful verification.
```

### Phase 9 — Documentation
```
Implement Phase 9.

Complete all documentation, including architecture, agent responsibilities, skills, rules, integrations, security, installation, configuration, troubleshooting, testing, and maintenance.

Check that all instructions match the actual implementation.
```

### Phase 10 — Release
```
Implement Phase 10.

Prepare the first Frontier Engineer release. Verify the plugin using official tooling, perform a clean-environment installation test, review package contents, update the changelog, create the ZIP archive, and write release notes.

Clearly distinguish a successfully validated plugin from a package that is only partially implemented.
```
