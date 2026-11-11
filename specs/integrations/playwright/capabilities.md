# Playwright Integration Capabilities

This document provides detailed specifications for tools provided by the official `@playwright/mcp` browser testing integration.

## Permission Class Summary

| Tool Name                 | Permission Class | Target Scope                 | Human Confirmation Required | Agent Affinity                                        |
| :------------------------ | :--------------- | :--------------------------- | :-------------------------- | :---------------------------------------------------- |
| `browser_navigate`        | Read-only        | Local / Staging URL          | No                          | `frontier-engineer`, `qa-engineer`, `design-engineer` |
| `browser_take_screenshot` | Read-only        | Viewport or element snapshot | No                          | `frontier-engineer`, `qa-engineer`, `design-engineer` |
| `browser_snapshot`        | Read-only        | Accessibility tree           | No                          | `frontier-engineer`, `qa-engineer`, `design-engineer` |
| `browser_click`           | Reversible write | Clickable elements           | No (in test environments)   | `frontier-engineer`, `qa-engineer`                    |
| `browser_fill_form`       | Reversible write | Form input elements          | No (in test environments)   | `frontier-engineer`, `qa-engineer`                    |
| `browser_hover`           | Reversible write | Interactive element          | No                          | `frontier-engineer`, `design-engineer`                |
| `browser_select_option`   | Reversible write | Dropdown selection           | No                          | `frontier-engineer`, `qa-engineer`                    |

## Tool Specifications

### `browser_navigate`

- **Description:** Navigates the browser context to a target URL.
- **Parameters:**
  - `url` (string, required): Destination URL (must match localhost, 127.0.0.1, or approved test origins).
- **Output:** Navigation outcome with page title and HTTP status code.

### `browser_take_screenshot`

- **Description:** Captures a PNG screenshot of the current page or specific DOM element.
- **Parameters:**
  - `name` (string, required): Artifact identifier.
  - `selector` (string, optional): CSS selector to isolate an element.
  - `fullPage` (boolean, optional): Capture full scrollable page.
- **Output:** Path to saved image artifact or base64 representation.

### `browser_snapshot`

- **Description:** Generates an accessible snapshot tree of the current page conforming to WCAG principles.
- **Parameters:**
  - `rootSelector` (string, optional): Subtree selector. Defaults to document root.
- **Output:** Structured tree showing accessible names, roles, states, and values.

### `browser_click`

- **Description:** Dispatches a click interaction to trigger client-side state changes.
- **Parameters:**
  - `selector` (string, required): Target element selector.
- **Output:** Click event confirmation.

### `browser_fill_form`

- **Description:** Types synthetic test data into an input, textarea, or contenteditable field.
- **Parameters:**
  - `selector` (string, required): Input element selector.
  - `value` (string, required): Synthetic text value.
- **Output:** Confirmation of resulting value.

### `browser_hover`

- **Description:** Hovers pointer over an element to reveal tooltips or hover states.
- **Parameters:**
  - `selector` (string, required): Target element selector.
- **Output:** Hover event confirmation.

### `browser_select_option`

- **Description:** Selects an option within a native HTML `<select>` element.
- **Parameters:**
  - `selector` (string, required): Select element selector.
  - `value` (string, required): Option value to choose.
- **Output:** Confirmation of selected option.
