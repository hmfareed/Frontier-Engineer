---
id: code-quality
name: Code Quality
category: engineering
triggerType: glob
globs: "**/*.{ts,tsx,js,jsx,py,go,java,rs}"
description: Code quality standards forbidding unnecessary duplication, excessive abstraction, hidden side effects, and unvalidated external inputs.
priority: 7
enforcementLevel: mandatory
platformConfig: {}
---

# Code Quality Rule

## Purpose

The Code Quality rule governs structural clarity, maintainability, and readability of source code. It eliminates unnecessary complexity, prevents premature abstraction, and ensures that functions remain focused and predictable.

## Scope and applicability

Applies to all source code files during authoring, modification, or refactoring across all languages and application layers.

## Core standards

- **Focused Functions:** Design functions that do one thing well. Keep function complexity and parameter counts bounded.
- **Readable Over Clever:** Prioritize self-documenting code with descriptive identifier names over convoluted one-liners or esoteric language tricks.
- **Avoid Premature Abstraction:** Do not construct generic frameworks or deep class hierarchies for single-use cases. Apply DRY (Don't Repeat Yourself) when duplication is proven, not preemptively.
- **Pure Functions Where Feasible:** Maximize pure functions that compute outputs solely from inputs without mutating external state.
- **Explicit Boundary Validation:** Validate all external inputs, API parameters, and environment configurations at system entry points.

## Invariants and prohibitions

- **Prohibited:** Hidden side effects where a getter or utility function silently mutates global state, alters file systems, or issues network calls.
- **Prohibited:** Magic numbers and unanchored string literals; declare named constants with clear semantic purpose.
- **Prohibited:** Deeply nested control flow (more than 3 levels of indentation); use guard clauses and early returns.
- **Prohibited:** Empty exception catch blocks (`catch (e) {}`) that swallow errors and conceal defects.

## Verification criteria

- Code can be read and understood without tracing multiple layers of unnecessary indirection.
- All branches and error conditions have explicit handling or intentional escalation.
- Static analysis and linting rules pass without suppressions or overrides.
