# Playwright Integration Capabilities

This document provides detailed specifications for tools provided by the official `@playwright/mcp` browser testing integration.

## Permission Class Summary

| Tool Name | Permission Class | Target Scope | Human Confirmation Required | Agent Affinity |
| :--- | :--- | :--- | :--- | :--- |
| `navigate` | Read-only | Local / Staging URL | No | `frontier-engineer`, `qa-engineer`, `design-engineer` |
| `screenshot` | Read-only | Viewport or element snapshot | No | `frontier-engineer`, `qa-engineer`, `design-engineer` |
| `accessibility_snapshot` | Read-only | Accessibility tree | No | `frontier-engineer`, `qa-engineer`, `design-engineer` |
| `click` | Reversible write | Clickable elements | No (in test environments) | `frontier-engineer`, `qa-engineer` |
| `fill` | Reversible write | Form input elements | No (in test environments) | `frontier-engineer`, `qa-engineer` |
| `hover` | Reversible write | Interactive element | No | `frontier-engineer`, `design-engineer` |
| `select` | Reversible write | Dropdown selection | No | `frontier-engineer`, `qa-engineer` |

## Tool Specifications

### `navigate`
- **Description:** Navigates the browser context to a target URL.
- **Parameters:**
  - `url` (string, required): Destination URL (must match localhost, 127.0.0.1, or approved test origins).
- **Output:** Navigation outcome with page title and HTTP status code.

### `screenshot`
- **Description:** Captures a PNG screenshot of the current page or specific DOM element.
- **Parameters:**
  - `name` (string, required): Artifact identifier.
  - `selector` (string, optional): CSS selector to isolate an element.
  - `fullPage` (boolean, optional): Capture full scrollable page.
- **Output:** Path to saved image artifact or base64 representation.

### `accessibility_snapshot`
- **Description:** Generates an accessible snapshot tree of the current page conforming to WCAG principles.
- **Parameters:**
  - `rootSelector` (string, optional): Subtree selector. Defaults to document root.
- **Output:** Structured tree showing accessible names, roles, states, and values.

### `click`
- **Description:** Dispatches a click interaction to trigger client-side state changes.
- **Parameters:**
  - `selector` (string, required): Target element selector.
- **Output:** Click event confirmation.

### `fill`
- **Description:** Types synthetic test data into an input, textarea, or contenteditable field.
- **Parameters:**
  - `selector` (string, required): Input element selector.
  - `value` (string, required): Synthetic text value.
- **Output:** Confirmation of resulting value.

### `hover`
- **Description:** Hovers pointer over an element to reveal tooltips or hover states.
- **Parameters:**
  - `selector` (string, required): Target element selector.
- **Output:** Hover event confirmation.

### `select`
- **Description:** Selects an option within a native HTML `<select>` element.
- **Parameters:**
  - `selector` (string, required): Select element selector.
  - `value` (string, required): Option value to choose.
- **Output:** Confirmation of selected option.
