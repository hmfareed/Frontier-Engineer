---
id: frontend-engineering
name: Frontend Engineering
title: Production Frontend Development and Component Architecture
version: 1
summary: Builds production-quality, accessible, and performant frontend experiences. Manages React, Next.js, and TypeScript components, state architectures, routing, forms, responsive design, the ten interaction states, and accessibility standards.
description: Use when building user interfaces, implementing React/Next.js/web components, managing frontend state, designing responsive layouts, integrating frontend APIs, optimizing bundle sizes, or ensuring WCAG accessibility.
requiredCapabilities:
  - repository-inspection
  - code-editing
  - ui-inspection
  - accessibility-review
  - browser-inspection
  - test-execution
primaryAgents:
  - implementation-engineer
  - design-engineer
  - frontier-engineer
activationTriggers:
  - building or refactoring UI components and pages
  - implementing complex frontend state and asynchronous data fetching
  - ensuring responsive design across desktop, tablet, and mobile viewports
  - auditing or fixing accessibility and keyboard navigation issues
  - integrating forms with validation, error states, and submission handling
nonActivationGuidelines:
  - pure backend API logic without UI rendering
  - database migration scripts and SQL schema design
  - server-side security infrastructure or network configuration
  - non-UI system performance profiling
platformConfig: {}
---

# Frontend Engineering (canonical specification)

## Purpose

The Frontend Engineering skill provides a disciplined, production-grade methodology for developing web user interfaces. It ensures that component architecture, responsive design, state management, accessibility (WCAG AA), and user interaction handling are built to rigorous standards, avoiding brittle layouts, unhandled async states, or inaccessible interactive controls.

## Activation criteria

Activate this skill when:

- Creating, modifying, or refactoring user interfaces and design system components.
- Implementing client-side or server-side rendered views in frameworks like React, Next.js, Vue, or Svelte.
- Managing frontend state, forms, input validation, and asynchronous data fetching.
- Resolving layout breakages, responsive viewport inconsistencies, or UI state regressions.
- Ensuring compliance with accessibility standards (WCAG 2.1 AA) and keyboard navigation.

## Non-activation guidelines

Do not activate this skill when:

- Designing database schemas, SQL queries, or backend ORM models.
- Authoring purely server-side background job processors or queues.
- Configuring cloud infrastructure, reverse proxies, or network firewalls.
- Writing command-line scripts or build configuration without web UI implications.

## Required context and inputs

Before implementing frontend code:

1. **Existing Stack & Conventions:** Framework (React, Next.js, etc.), styling system (Tailwind, CSS Modules, styled-components), state management library, and package versions.
2. **Design Specifications:** Wireframes, Figma specifications, design tokens, color palette, and spacing scales.
3. **API Contracts:** Backend endpoints, payload schemas, query parameters, authentication headers, and error response formats.
4. **Target Viewports & Devices:** Minimum supported viewport (e.g., 320px mobile) up to high-DPI desktop displays.

## Operating procedure

Execute the following twelve-step frontend engineering workflow:

1. **Inspect Existing Frontend:** Audit the existing component hierarchy, design tokens, typography, and styling conventions.
2. **Understand Framework & Conventions:** Adhere strictly to repository idioms (e.g., App Router vs. Pages Router in Next.js, client vs. server components).
3. **Identify Reusable Components:** Search for existing buttons, inputs, modals, and typography components before creating new ones.
4. **Understand the Design System:** Extract defined color variables, spacing tokens, and border-radius conventions.
5. **Define Component Responsibilities:** Break down the feature into single-responsibility, composable components with explicit TypeScript interfaces for props.
6. **Implement Component Structure:** Author semantic HTML elements (`<button>`, `<main>`, `<nav>`, `<section>`, `<article>`) rather than generic `<div>` wrappers.
7. **Implement Interactions & State:** Wire up state management, controlled inputs, and event handlers with clear data flow.
8. **Handle All Ten Interaction States:** Implement default, hover, focus, active/pressed, disabled, loading, empty, error, success, and responsive/mobile states.
9. **Verify Accessibility (a11y):** Test keyboard navigation (`Tab`, `Enter`, `Space`, `Esc`), focus trapping in modals, ARIA labels, and color contrast.
10. **Verify Responsive Behavior:** Validate layout across mobile (320px, 375px), tablet (768px), and desktop (1024px, 1440px) breakpoints without horizontal overflow.
11. **Run Relevant Tests:** Execute component unit tests, accessibility audits, and integration checks.
12. **Inspect Rendered Result:** When browser or preview tools are available, visually inspect the rendered UI to verify layout integrity and smooth rendering.

## Technical and engineering standards

- **Semantic HTML First:** Always prefer native elements (`<button>` over `<div onClick>`). Native elements provide built-in focusability, keyboard events, and screen reader roles.
- **Visible Focus Rings:** Never set `outline: none` or `outline: 0` without providing a high-contrast, accessible alternative focus indicator.
- **Async State Completeness:** Never render a data-dependent component without explicit handling for loading, empty, and error states.
- **Clean Props Contracts:** Prop interfaces must be typed explicitly with TypeScript. Avoid `any` or untyped spread operators (`...props`).
- **No Layout Shift (CLS):** Reserve space for asynchronous content (skeletons, aspect-ratio containers) to prevent cumulative layout shifts during page loading.
- **Framework Respect:** Do not introduce React into a Vue codebase, or Tailwind into an existing Vanilla CSS / BEM architecture without explicit architectural mandate.

## Verification and evidence requirements

- Demonstrate that all interactive elements are reachable and operable via keyboard.
- Provide verification that color contrast meets or exceeds WCAG AA (4.5:1 for normal text).
- Check that no console errors, hydration mismatches, or unhandled promise rejections occur during component rendering.
- Run typecheck and component test commands, citing passing execution outputs.

## Expected outputs and deliverables

- **Component Implementation:** Modular, accessible, and clean TypeScript/TSX source files.
- **Styling & Token Definitions:** CSS/Tailwind utility classes adhering to the project's design system.
- **Automated Component Tests:** Unit and interaction tests checking rendering, state changes, and accessibility.
- **State Documentation:** Verification of all ten interaction states.

## Risks, boundaries and failure modes

- **Hardcoded Placeholder Data:** Leaving static mockup data in production components instead of integrating real API contracts.
- **Keyboard Traps:** Creating modals or dropdowns that trap keyboard focus without allowing escape via `Esc` or `Tab`.
- **Horizontal Overflow:** Allowing wide elements, fixed-pixel widths, or unbreakable strings to force horizontal scrolling on mobile viewports.

## Progressive disclosure references

For specifications on the 10 interaction states, focus trapping, and WCAG AA guidelines:

- [Frontend Engineering: The 10 Interaction States and Accessibility Guide](./references/frontend-engineering/interaction-states-and-a11y-guide.md)
