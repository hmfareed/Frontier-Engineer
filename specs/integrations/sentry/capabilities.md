# Sentry Integration Capabilities

This document specifies the tools, parameters, and invocation contracts for the Sentry observability integration.

## Permission Class Summary

| Tool Name                   | Permission Class | Target Scope             | Human Confirmation Required | Agent Affinity                                                             |
| :-------------------------- | :--------------- | :----------------------- | :-------------------------- | :------------------------------------------------------------------------- |
| `get_issue`                 | Read-only        | Sentry issue             | No                          | `frontier-engineer`, `architect`, `implementation-engineer`, `qa-engineer` |
| `list_unresolved_events`    | Read-only        | Event catalog            | No                          | `frontier-engineer`, `implementation-engineer`, `qa-engineer`              |
| `get_stack_trace`           | Read-only        | Event stack trace        | No                          | `frontier-engineer`, `implementation-engineer`, `qa-engineer`              |
| `get_release_stats`         | Read-only        | Release health metrics   | No                          | `frontier-engineer`, `architect`, `qa-engineer`                            |
| `query_project_performance` | Read-only        | Performance transactions | No                          | `frontier-engineer`, `architect`, `implementation-engineer`                |
| `update_issue_status`       | Reversible write | Issue status             | No (reversible)             | `frontier-engineer`, `qa-engineer`                                         |
| `add_issue_note`            | Reversible write | Issue activity log       | No (reversible)             | `frontier-engineer`, `implementation-engineer`, `qa-engineer`              |
| `assign_issue`              | Reversible write | Issue assignee           | No (reversible)             | `frontier-engineer`, `qa-engineer`                                         |

## Tool Specifications

### `get_issue`

- **Description:** Retrieves high-level details for a Sentry issue.
- **Parameters:**
  - `issue_id` (string, required): Sentry issue ID or short ID.
  - `org_slug` (string, optional): Organization slug.
- **Output:** Issue metadata including title, culprit, frequency, count, first seen, and last seen.

### `list_unresolved_events`

- **Description:** Lists recent unresolved error events matching query filters.
- **Parameters:**
  - `project_slug` (string, required): Target project slug.
  - `query` (string, optional): Sentry search query (e.g., `is:unresolved level:error`).
  - `limit` (integer, optional): Maximum events to return (default: 10).
- **Output:** Array of error events with timestamps and brief messages.

### `get_stack_trace`

- **Description:** Retrieves symbolicated stack frames, code context, and breadcrumbs for an event.
- **Parameters:**
  - `event_id` (string, required): Sentry event ID.
- **Output:** Formatted stack trace with filenames, line numbers, function names, and enclosing code.

### `get_release_stats`

- **Description:** Summarizes release stability metrics including crash-free user percentages and adoption rates.
- **Parameters:**
  - `release` (string, required): Release version string.
  - `project_slug` (string, required): Target project slug.
- **Output:** Total sessions, unhandled crash count, and crash-free session percentage.

### `query_project_performance`

- **Description:** Queries transaction latency, throughput, and error rate data.
- **Parameters:**
  - `project_slug` (string, required): Target project slug.
  - `transaction` (string, optional): Filter by transaction name (e.g., `GET /api/v1/users`).
  - `timeframe` (string, optional): Time range (e.g., `24h`, `7d`).
- **Output:** Performance metrics including p50, p95, throughput, and Apdex score.

### `update_issue_status`

- **Description:** Updates the status of an issue (e.g., marking as resolved in next release).
- **Parameters:**
  - `issue_id` (string, required): Target issue ID.
  - `status` (string, required): `resolved`, `unresolved`, or `ignored`.
- **Output:** Updated issue status.

### `add_issue_note`

- **Description:** Attaches a diagnostic note or link to an issue.
- **Parameters:**
  - `issue_id` (string, required): Target issue ID.
  - `text` (string, required): Markdown note content.
- **Output:** Created note object with ID.

### `assign_issue`

- **Description:** Changes the assignee of an issue.
- **Parameters:**
  - `issue_id` (string, required): Target issue ID.
  - `assignee` (string, required): User email or team slug.
- **Output:** Assignment confirmation.
