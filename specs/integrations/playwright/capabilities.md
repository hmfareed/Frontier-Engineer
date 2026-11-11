# Playwright Integration Capabilities

This document provides detailed specifications for tools provided by the Playwright browser testing integration.

## Permission Class Summary

| Tool Name                | Permission Class     | Target Scope                | Human Confirmation Required | Agent Affinity                                        |
| :----------------------- | :------------------- | :-------------------------- | :-------------------------- | :---------------------------------------------------- |
| `navigate`               | Read-only            | Local / Staging URL         | No                          | `frontier-engineer`, `qa-engineer`, `design-engineer` |
| `take_screenshot`        | Read-only            | Browser viewport / DOM node | No                          | `frontier-engineer`, `qa-engineer`, `design-engineer` |
| `get_accessibility_tree` | Read-only            | Accessibility tree          | No                          | `frontier-engineer`, `qa-engineer`, `design-engineer` |
| `get_console_logs`       | Read-only            | Browser console buffer      | No                          | `frontier-engineer`, `qa-engineer`                    |
| `query_dom_elements`     | Read-only            | DOM element selector        | No                          | `frontier-engineer`, `qa-engineer`, `design-engineer` |
| `fill_form`              | Reversible write     | Form input elements         | No (in test environments)   | `frontier-engineer`, `qa-engineer`                    |
| `click_element`          | Reversible write     | Clickable elements          | No (in test environments)   | `frontier-engineer`, `qa-engineer`                    |
| `submit_form`            | External side effect | Form submission             | Yes (if external/staging)   | `frontier-engineer`, `qa-engineer`                    |

## Tool Specifications

### `navigate`

- **Description:** Navigates to a target URL in the active browser context.
- **Parameters:**
  - `url` (string, required): Destination URL (must match localhost, 127.0.0.1, or approved test domains).
  - `waitUntil` (string, optional): `load`, `domcontentloaded`, or `networkidle`. Defaults to `load`.
- **Output:** HTTP status code, page title, and final URL.

### `take_screenshot`

- **Description:** Captures a PNG screenshot of the current page or a specific element.
- **Parameters:**
  - `name` (string, required): Artifact name for the screenshot.
  - `selector` (string, optional): CSS selector to isolate a specific element.
  - `fullPage` (boolean, optional): Capture full scrollable page. Defaults to false.
- **Output:** Path to saved image artifact or base64 encoded image string.

### `get_accessibility_tree`

- **Description:** Computes the full accessibility tree snapshot for WCAG auditing.
- **Parameters:**
  - `rootSelector` (string, optional): Subtree root selector. Defaults to page root.
- **Output:** Nested tree structure showing roles, accessible names, values, and states.

### `get_console_logs`

- **Description:** Returns captured browser console messages and uncaught exceptions.
- **Parameters:**
  - `level` (string, optional): Filter level (`error`, `warn`, `info`, `all`). Defaults to `all`.
- **Output:** Array of log objects with level, text, source, and stack trace.

### `query_dom_elements`

- **Description:** Evaluates a CSS selector or XPath query and returns element attributes and text.
- **Parameters:**
  - `selector` (string, required): Selector string.
  - `limit` (integer, optional): Maximum matching elements to return (default: 10).
- **Output:** Array of element summaries containing tag, classes, attributes, and text.

### `fill_form`

- **Description:** Types synthetic test data into an input, textarea, or select element.
- **Parameters:**
  - `selector` (string, required): Input element selector.
  - `value` (string, required): Synthetic text value to enter.
- **Output:** Operation confirmation and resulting input value.

### `click_element`

- **Description:** Dispatches a click event to trigger client-side interactions.
- **Parameters:**
  - `selector` (string, required): Element selector.
  - `button` (string, optional): `left`, `right`, or `middle`. Defaults to `left`.
- **Output:** Click confirmation.

### `submit_form`

- **Description:** Submits a form element, potentially triggering server-side requests.
- **Parameters:**
  - `selector` (string, required): Form element selector.
- **Output:** Submission outcome and resulting navigation or response status.
