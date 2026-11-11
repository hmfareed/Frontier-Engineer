# ADR-001: Foundation architecture

- **Status:** Accepted
- **Date:** 2026-11-10
- **Deciders:** Phase 1 foundation work
- **Related:** [Part 27 verification record](../27-OFFICIAL-FORMAT-VERIFICATION.md), [Part 20 repository structure](../20-REPOSITORY-STRUCTURE.md)

## Context

The original Frontier Engineer specification is a 26-part description of a multi-agent engineering system. Phase 1 must turn it into a real, installable foundation without inventing Antigravity features. Before writing any component, the official plugin, agent, skill, rule, MCP, and hook formats were verified against official documentation and the locally installed `agy` CLI 1.5.0.

## Decisions

### 1. The repository root is the plugin root

Antigravity plugins place `plugin.json`, `skills/`, `agents/`, `rules/`, `scripts/`, `mcp_config.json`, and `hooks.json` at `<plugin-root>`. This matches the logical layout the specification proposed, so no adaptation is needed.

An earlier desk review suspected `plugin.json` was borrowed from Claude Code or Codex and that `.agents/` should replace root directories. Verification disproved this. `.agents/` is the **workspace customization** scope, while the root-level layout is the **plugin** scope. Conflating the two would have broken discovery.

**Consequence:** the repository is directly validatable with `agy plugin validate --strict .`. Extra directories (`docs/`, `tests/`, `.github/`, the specification archive) are ignored by the loader.

### 2. Frontier Engineer is not a conventional web application

Antigravity already supplies the runtime, model access, tool execution, conversation loop, and delegation. A React frontend, backend API, or database would duplicate the host and add an unsupported runtime dependency.

**Consequence:** the deliverable is Markdown, YAML frontmatter, JSON configuration, and small TypeScript validation utilities. No runtime npm dependencies are declared.

### 3. Antigravity is the execution environment

The specification targets Antigravity and Gemini. The plugin format, subagent delegation, progressive-disclosure skills, rules, MCP, and hooks are all native Antigravity capabilities verified on 2026-11-10. Portability to other agent platforms is explicitly **not** a Phase 1 goal, because their formats differ.

**Consequence:** no `.claude-plugin/`, `.cursor-plugin/`, or foreign hook paths are present; the validator flags them.

### 4. TypeScript is used only for supporting automation

Validation utilities benefit from static types, but agents and skills are data, not code. Node.js 22.6+ executes `.ts` files directly via native type stripping, so no bundler or transpiler is needed.

**Consequence:** `tsc --noEmit` checks the scripts; no build output exists; no runtime TypeScript dependency is introduced.

### 5. Markdown and YAML are the authoring formats

Antigravity natively reads `SKILL.md`, agent `.md` files with YAML frontmatter, and rule `.md` files. These formats are inspectable, diffable, and directly consumable by the agent.

**Consequence:** all component metadata is constrained to verified frontmatter keys. Local JSON Schema transcriptions in `schemas/` reject invented fields.

### 6. Local schemas are transcriptions, not the official schema

The schemas in `schemas/` are draft-07 transcriptions of the verified constraints so that Ajv validation works offline and in CI. `agy plugin validate --strict .` remains authoritative.

**Consequence:** if Antigravity changes its schema, both the transcriptions and the official CLI check must be re-run.

### 7. Only one foundational rule ships in Phase 1

`rules/AGENTS.md` carries the fifteen engineering principles as an always-on rule. The full modular rule set belongs to Phase 4, where `trigger`-based rules are introduced.

**Consequence:** the plugin has one always-on rule and avoids premature, unverified rule metadata.

### 8. MIT license, pending owner confirmation

`LICENSE` uses MIT with a generic contributors copyright line. This is a reversible default chosen so the plugin manifest can declare an SPDX identifier.

**Consequence:** the project owner must confirm the license and copyright holder before any distribution.

## Verified in Phase 1

Plugin manifest schema and validation, plugin root layout, agent/skill/rule formats and discovery paths, MCP config schema, hooks events and schema, `agy` CLI commands, delegation mechanism (documented), and Node.js native TypeScript execution. Sources and dates are in [Part 27](../27-OFFICIAL-FORMAT-VERIFICATION.md).

## Not verified in Phase 1

Plugin installation and runtime discovery, subagent delegation in practice, hook execution, MCP connectivity, and Marketplace acceptance. No claim of a working agent system is made at this phase.

## Proposed architecture (not implemented)

The six-layer model, ten-stage execution lifecycle, six agents with their boundaries, ten skills, three workflow modes, project intelligence, engineering memory, and the evaluation suite remain **proposed design** recorded in [Part 03](../03-SYSTEM-ARCHITECTURE.md). They are not implemented, not loaded, and not tested.

## Alternatives considered

| Alternative                                  | Rejected because                                                    |
| -------------------------------------------- | ------------------------------------------------------------------- |
| Build a Next.js control dashboard            | Duplicates the Antigravity host; adds runtime dependencies          |
| Put everything under `.agents/` at repo root | Wrong scope for a distributable plugin                              |
| Use a Claude Code / Codex plugin manifest    | Different schema and discovery behavior                             |
| Implement all six agents immediately         | Violates phase discipline and prevents format verification first    |
| Assume native persistent agent memory        | No such capability found; project files are the supported mechanism |
