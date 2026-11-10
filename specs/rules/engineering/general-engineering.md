---
id: general-engineering
name: General Engineering
category: engineering
triggerType: glob
globs: "**/*.{ts,tsx,js,jsx,py,go,java,rs,c,cpp,cs}"
description: Foundational software engineering standards for repository inspection, naming conventions, separation of concerns, and maintainability.
priority: 8
enforcementLevel: mandatory
platformConfig: {}
---

# General Engineering Rule

## Purpose

The General Engineering rule enforces foundational software engineering practices across all implementation tasks. It ensures that changes respect existing repository architecture, adhere to established naming idioms, maintain clean separation of concerns, and minimize cognitive complexity.

## Scope and applicability

Applies to all source code files across supported programming languages when creating, refactoring, or modifying application functionality.

## Core standards

- **Inspect Before Modifying:** Always inspect entry points, directory conventions, and existing patterns before introducing new files or functions.
- **Idiomatic Consistency:** Match the naming conventions (camelCase, snake_case, PascalCase) and file organization already present in the codebase.
- **Separation of Concerns:** Keep presentation, business logic, data persistence, and transport concerns strictly isolated.
- **Explicit Type Safety:** In typed languages, declare explicit interfaces and types. Avoid untyped bypasses (`any`, `@ts-ignore`, `unsafe`) unless strictly required and justified.
- **Graceful Error Propagation:** Catch errors at appropriate architectural boundaries; handle failure states explicitly rather than silently suppressing them.

## Invariants and prohibitions

- **Prohibited:** Speculative total rewrites when incremental, focused modifications achieve the requirement.
- **Prohibited:** Introducing new external libraries or npm/pip dependencies without concrete justification and verification.
- **Prohibited:** Circular imports between modules or layering inversions (e.g. database repositories depending on HTTP controllers).
- **Prohibited:** Dead code, commented-out obsolete logic, or abandoned debugging code committed to production paths.

## Verification criteria

- Verify that `git diff` contains only focused changes directly relevant to the assigned task.
- Verify that type-checking and linting commands pass with zero errors.
- Confirm that existing project conventions were preserved across all modified files.
