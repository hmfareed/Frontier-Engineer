---
trigger: "glob"
globs: "**/*.{tsx,jsx,vue,svelte,css,scss,html}"
description: "Frontend architectural standards for component isolation, state management, semantic structure, responsive layouts, and performance."
---

# Frontend Standards Rule

> Generated from `specs/rules/frontend/frontend-standards.md` by `scripts/generate-antigravity-rules.ts`. Edit the canonical specification, not this file.

## Purpose

The Frontend Standards rule establishes framework-agnostic engineering practices for client-side user interfaces. It ensures components maintain high cohesion, predictable state transitions, responsive design integrity, semantic structure, and robust handling of asynchronous states.

## Scope and applicability

Applies to all frontend source files, templates, style sheets, and client components across web frameworks (React, Vue, Svelte, Angular, vanilla DOM) when designing or modifying user interfaces.

## Core standards

- **Component Decomposition:** Decompose complex views into focused, single-responsibility components with well-defined input props/attributes and emitted events.
- **State Locality and Predictability:** Keep state as local as possible. Distinguish between server cache, URL state, ephemeral UI state, and persistent global state; prevent duplicated sources of truth.
- **Complete Asynchronous UI States:** Every asynchronous data fetch, mutation, or submission must account for all lifecycle states: initial idle, loading indicator/skeleton, error alert with retry, empty collection state, and successful rendering.
- **Semantic Structure and Responsive Layouts:** Use native semantic HTML elements (`<main>`, `<header>`, `<nav>`, `<article>`, `<button>`, `<dialog>`) and design mobile-first responsive layouts that degrade gracefully without layout shifts (CLS).
- **Client-Side Security:** Never trust client-side validation alone; sanitize user-rendered content to prevent cross-site scripting (XSS), avoid dangerous inner HTML injections, and avoid embedding confidential tokens in client-accessible bundles.

## Invariants and prohibitions

- **Prohibited:** Storing sensitive secrets, private API keys, or administrative tokens in client-side code, bundles, or local storage.
- **Prohibited:** Uncontrolled layout thrashing, unoptimized heavy asset bundling, or unmemoized expensive calculations that degrade input responsiveness (INP).
- **Prohibited:** Missing error states that leave the interface in an unresponsive infinite loading spinner when a network request fails.
- **Prohibited:** Overriding native interactive elements (`<button>`, `<a>`) with unstyled `<div>` or `<span>` tags lacking keyboard and screen reader support.

## Verification criteria

- Verify in a browser or test runner that loading, empty, and error states render correctly under mocked network conditions.
- Confirm responsive layout stability across standard viewport breakpoints without horizontal scroll overflow.
- Verify that forms validate user inputs client-side while cleanly surfacing server validation errors.
