---
trigger: "glob"
globs: "**/*.{md,mdx},docs/**"
description: "Technical documentation standards for architecture records, APIs, operational guides, and project documentation."
---

# Documentation Standards Rule

> Generated from `specs/rules/engineering/documentation.md` by `scripts/generate-antigravity-rules.ts`. Edit the canonical specification, not this file.

## Purpose

The Documentation Standards rule enforces precision, accuracy, and currency across all repository documentation. It ensures that technical decisions, public interfaces, setup workflows, and operational guides accurately reflect current implementations without misleading assertions or fabricated capabilities.

## Scope and applicability

Applies to all Markdown documentation, architecture decision records (ADRs), API specifications, code docstrings, and setup guides when authoring or revising project documentation.

## Core standards

- **Accurate Public Interfaces:** Document all public interfaces, exported functions, configuration parameters, and environment variables with concrete descriptions and accurate types.
- **Architectural Decision Records:** Record significant architectural, data modeling, security, or infrastructural decisions in structured ADR format capturing context, decision, alternatives considered, and consequences.
- **Synchronized Setup Instructions:** Keep onboarding steps, prerequisite software lists, environment configurations, and build/test commands synchronized with the actual repository state.
- **Reflect Behavior Changes:** Whenever functional behavior, breaking changes, or deprecations are introduced, update the corresponding documentation files in the same changeset.
- **Concrete Verification Steps:** When documenting procedures, provide runnable verification commands and expected terminal outputs rather than vague summaries.

## Invariants and prohibitions

- **Prohibited:** Documenting planned, speculative, or unsupported capabilities as currently implemented or verified.
- **Prohibited:** Stale or conflicting instructions between root documentation and subsystem READMEs.
- **Prohibited:** Fabricating parameter names, return values, API routes, or error formats in documentation examples.
- **Prohibited:** Removing documentation of known caveats, architectural constraints, or limitations to create an illusion of completeness.

## Verification criteria

- Verify that all code examples, shell commands, and configuration snippets in documentation are executable or syntactically valid.
- Confirm that every documented command succeeds or matches current project configuration.
- Check that no documented features contradict the canonical specifications or actual code implementation.
