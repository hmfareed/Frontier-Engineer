# Sentry Integration Capabilities

This document specifies the tools, parameters, and invocation contracts for the official Sentry observability integration (`@sentry/mcp-server`).

## Permission Class Summary

| Tool Name       | Permission Class | Target Scope                       | Human Confirmation Required | Agent Affinity                                                             |
| :-------------- | :--------------- | :--------------------------------- | :-------------------------- | :------------------------------------------------------------------------- |
| `get_issue`     | Read-only        | Sentry issue summary               | No                          | `frontier-engineer`, `architect`, `implementation-engineer`, `qa-engineer` |
| `list_issues`   | Read-only        | Project issue catalog              | No                          | `frontier-engineer`, `implementation-engineer`, `qa-engineer`              |
| `get_event`     | Read-only        | Detailed crash event & stack trace | No                          | `frontier-engineer`, `implementation-engineer`, `qa-engineer`              |
| `list_events`   | Read-only        | Issue event occurrences            | No                          | `frontier-engineer`, `implementation-engineer`, `qa-engineer`              |
| `search_issues` | Read-only        | Sentry issue search query          | No                          | `frontier-engineer`, `architect`, `implementation-engineer`, `qa-engineer` |

## Tool Specifications

### `get_issue`

- **Description:** Retrieves issue metadata, culprit, frequency, first seen, and last seen timestamps.
- **Parameters:**
  - `issue_id` (string, required): Sentry issue ID or short ID.
  - `org_slug` (string, optional): Organization slug.
- **Output:** Issue metadata including title, culprit, frequency, count, first seen, and last seen.

### `list_issues`

- **Description:** Lists issues matching query filters (e.g., `is:unresolved level:error`).
- **Parameters:**
  - `project_slug` (string, required): Target project slug.
  - `query` (string, optional): Search query string.
  - `limit` (integer, optional): Maximum issues to return (default: 10).
- **Output:** Array of issue objects.

### `get_event`

- **Description:** Retrieves symbolicated stack frames, code context, and user breadcrumbs for a specific crash event.
- **Parameters:**
  - `event_id` (string, required): Sentry event ID.
- **Output:** Formatted stack trace with filenames, line numbers, function names, and enclosing code.

### `list_events`

- **Description:** Lists recent error events associated with a specific issue.
- **Parameters:**
  - `issue_id` (string, required): Sentry issue ID.
  - `limit` (integer, optional): Maximum events to return (default: 10).
- **Output:** Array of event objects with timestamps and brief messages.

### `search_issues`

- **Description:** Searches Sentry issues across an organization or project by keyword.
- **Parameters:**
  - `query` (string, required): Search query.
  - `project_slug` (string, optional): Project slug to restrict search.
- **Output:** Array of matching issue references.
