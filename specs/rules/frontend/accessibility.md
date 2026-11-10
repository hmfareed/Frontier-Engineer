---
id: accessibility
name: Accessibility Standards
category: frontend
triggerType: glob
globs: "**/*.{tsx,jsx,vue,svelte,html}"
description: Web accessibility standards enforcing WCAG 2.1 AA compliance, keyboard navigation, accessible names, focus visibility, and ARIA roles.
priority: 8
enforcementLevel: mandatory
platformConfig: {}
---

# Accessibility Standards Rule

## Purpose

The Accessibility Standards rule enforces inclusive user interface development aligned with WCAG 2.1 Level AA criteria. It ensures that applications remain fully operable and perceivable through keyboards, screen readers, switch devices, and diverse visual and cognitive preferences.

## Scope and applicability

Applies to all markup, component templates, design system tokens, and interactive UI controls rendered in web and mobile-web applications.

## Core standards

- **Keyboard Operability:** Every interactive element (buttons, links, inputs, disclosures, dialogs) must be reachable and actionable via keyboard alone (`Tab`, `Shift+Tab`, `Enter`, `Space`, and Arrow keys where standardized).
- **Visible Focus Indicators:** Maintain clear, high-contrast visual focus rings on all active elements. Never remove default outlines (`outline: none`) without providing an equally prominent custom focus indicator.
- **Accessible Names and Labels:** All interactive elements must have unambiguous accessible names computed via text content, `aria-label`, or `aria-labelledby`. All form inputs must have associated `<label>` elements.
- **Color Contrast and Semantics:** Ensure minimum contrast ratios (4.5:1 for standard text, 3:1 for large text and UI components). Never convey critical state, error conditions, or selections purely through color.
- **Motion and Sensory Adaptability:** Honor user system preferences by wrapping non-essential animations in `@media (prefers-reduced-motion: reduce)` queries. Ensure modal dialogs trap focus and close on `Escape`.

## Invariants and prohibitions

- **Prohibited:** Trapping keyboard focus in non-modal containers or preventing standard tab order progression.
- **Prohibited:** Icon-only buttons or link controls lacking an accessible name or screen-reader announcement.
- **Prohibited:** Misusing ARIA attributes (`aria-hidden="true"` on interactive elements, invalid role hierarchies, or redundant roles on native elements).
- **Prohibited:** Autoplaying media with sound or flashing content exceeding three flashes per second.

## Verification criteria

- Verify complete keyboard navigation through all interactive flows without mouse interaction.
- Run automated accessibility audits (e.g. axe-core, lighthouse, or framework linters) with zero critical or serious violations.
- Confirm screen reader announcements and accessible names using accessibility tree inspection tools.
