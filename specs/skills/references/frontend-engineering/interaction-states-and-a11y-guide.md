# Frontend Engineering: The 10 Interaction States and Accessibility Guide

This reference provides technical specifications for component state handling, responsive design, and WCAG AA accessibility compliance.

## 1. The Ten Mandatory Interaction States

Every interactive component (buttons, inputs, cards, dialogs, lists) must define its visual and behavioral representation across all ten states:

| State                       | Purpose             | Required Visual & Functional Attributes                                                                                      |
| :-------------------------- | :------------------ | :--------------------------------------------------------------------------------------------------------------------------- |
| **1. Default**              | Rest state          | High-contrast label, clear hit target (min 44x44px for touch), legible typography.                                           |
| **2. Hover**                | Mouse affordance    | Subtle background/border tint shift; cursor: pointer; avoid layout shifts.                                                   |
| **3. Focus**                | Keyboard navigation | High-contrast focus ring (`outline: 2px solid var(--ring); outline-offset: 2px`). Never `outline: none` without replacement! |
| **4. Active / Pressed**     | Immediate feedback  | Slight scale/elevation reduction (e.g. `transform: scale(0.98)` or depressed shadow).                                        |
| **5. Disabled**             | Inactive control    | `aria-disabled="true"`, muted opacity (0.5–0.6), `pointer-events: none` or blocked click handler.                            |
| **6. Loading**              | Async in-progress   | Spinner or pulse skeleton; retain original element dimensions; disable interaction; `aria-busy="true"`.                      |
| **7. Empty**                | Zero data present   | Clear, helpful message explaining why no data is shown, paired with a call-to-action to create or search.                    |
| **8. Error**                | Validation failure  | Accessible error message paired with `aria-invalid="true"` and `aria-describedby="error-id"`; red/alert token border.        |
| **9. Success**              | Operation completed | Temporary confirmation message, checkmark icon, or toast notification with `role="status"`.                                  |
| **10. Responsive / Mobile** | Screen adaptation   | Fluid wrapping, touch-friendly tap targets, legible text without horizontal scrolling on 320px–1920px viewports.             |

---

## 2. Accessibility (a11y) Verification Standards

All components must satisfy WCAG 2.1 AA standards:

1. **Color Contrast:**
   - Normal text (< 18pt / 24px): Minimum contrast ratio of **4.5:1** against its background.
   - Large text (>= 18pt / 24px regular or >= 14pt / 18.5px bold): Minimum ratio of **3:1**.
   - UI components and graphical objects: Minimum ratio of **3:1**.
2. **Keyboard Traversal:**
   - All interactive controls must be reachable via `Tab` and operable via `Enter` or `Space`.
   - Modals and dialogs must implement a **focus trap** on open, focus the first interactive element, and restore focus on `Esc` or close.
3. **Semantic HTML:**
   - Use native `<button>`, `<a>`, `<input>`, `<nav>`, `<main>`, `<header>` instead of `<div>` with `onClick`.
   - Form inputs must have an associated `<label htmlFor="id">`.
4. **Screen Reader Live Regions:**
   - Dynamic error updates or async notifications must use `aria-live="polite"` or `role="alert"`.
