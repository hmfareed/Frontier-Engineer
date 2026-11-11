# GitHub Integration Capabilities

This document provides the exhaustive specification of tools, operations, and parameters supported by the GitHub MCP integration.

## Permission Class Summary

| Tool Name                    | Permission Class     | Target Scope           | Human Confirmation Required | Agent Affinity                                                |
| :--------------------------- | :------------------- | :--------------------- | :-------------------------- | :------------------------------------------------------------ |
| `get_file_contents`          | Read-only            | Remote repository file | No                          | `frontier-engineer`, `implementation-engineer`                |
| `get_issue`                  | Read-only            | Target issue           | No                          | `frontier-engineer`, `qa-engineer`                            |
| `list_issues`                | Read-only            | Repository issues      | No                          | `frontier-engineer`, `qa-engineer`                            |
| `get_pull_request`           | Read-only            | Pull request details   | No                          | `frontier-engineer`, `qa-engineer`, `implementation-engineer` |
| `list_pull_requests`         | Read-only            | Pull request catalog   | No                          | `frontier-engineer`, `qa-engineer`                            |
| `list_commits`               | Read-only            | Commit history         | No                          | `frontier-engineer`, `implementation-engineer`                |
| `create_issue`               | Reversible write     | New issue              | No (reversible)             | `frontier-engineer`, `qa-engineer`                            |
| `add_issue_comment`          | Reversible write     | Issue / PR comment     | No (reversible)             | `frontier-engineer`, `implementation-engineer`, `qa-engineer` |
| `create_pull_request`        | Reversible write     | Pull request draft     | No (reviewable)             | `frontier-engineer`, `implementation-engineer`                |
| `update_pull_request_branch` | Reversible write     | PR branch              | No                          | `frontier-engineer`, `implementation-engineer`                |
| `close_issue`                | External side effect | Target issue           | Yes                         | `frontier-engineer`                                           |
| `merge_pull_request`         | External side effect | Target repository      | Yes                         | `frontier-engineer`                                           |
| `delete_branch`              | Destructive          | Target branch          | Yes                         | `frontier-engineer`                                           |

## Tool Specifications

### `get_file_contents`

- **Description:** Reads file contents from a specific commit or branch in the remote repository.
- **Parameters:**
  - `owner` (string, required): Repository owner or organization.
  - `repo` (string, required): Repository name.
  - `path` (string, required): Relative file path.
  - `ref` (string, optional): Branch, tag, or commit hash. Defaults to default branch.
- **Output:** Decoded text content or raw base64 data.

### `get_issue`

- **Description:** Retrieves an issue's title, body, author, state, labels, and comments.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `issue_number` (integer, required): Issue number.
- **Output:** Structured issue object.

### `list_issues`

- **Description:** Retrieves open or closed issues matching criteria.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `state` (string, optional): `open`, `closed`, or `all`.
  - `labels` (array of strings, optional): Filter labels.
- **Output:** Array of issue summaries.

### `get_pull_request`

- **Description:** Retrieves pull request details, review comments, and diff information.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `pull_number` (integer, required): Pull request number.
- **Output:** Detailed PR metadata and change status.

### `list_pull_requests`

- **Description:** Lists repository pull requests with state filtering.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `state` (string, optional): `open`, `closed`, `all`.
- **Output:** Array of pull request summaries.

### `list_commits`

- **Description:** Retrieves commit log for a branch or path.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `sha` (string, optional): Branch name or commit SHA.
- **Output:** Array of commit objects.

### `create_issue`

- **Description:** Opens an issue to document bugs, technical debt, or tasks.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `title` (string, required): Issue title.
  - `body` (string, required): Markdown body.
  - `labels` (array of strings, optional): Initial labels.
- **Output:** Created issue details with URL.

### `add_issue_comment`

- **Description:** Posts an update, verification report, or review note on an issue or PR.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `issue_number` (integer, required): Issue or PR number.
  - `body` (string, required): Comment text.
- **Output:** Created comment object with timestamp.

### `create_pull_request`

- **Description:** Submits a pull request for completed feature work.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `title` (string, required): PR title.
  - `body` (string, required): PR description with verification evidence.
  - `head` (string, required): Head branch containing changes.
  - `base` (string, required): Base branch (e.g., `main`).
- **Output:** Created pull request object with HTML URL.

### `update_pull_request_branch`

- **Description:** Re-bases or merges base changes into a PR branch.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `pull_number` (integer, required): Pull request number.
- **Output:** Branch update status.

### `close_issue`

- **Description:** Resolves or closes an issue. Requires human confirmation.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `issue_number` (integer, required): Target issue.
- **Output:** Closed issue object.

### `merge_pull_request`

- **Description:** Merges a reviewed and verified pull request. Requires human confirmation.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `pull_number` (integer, required): PR number.
  - `merge_method` (string, optional): `merge`, `squash`, or `rebase`.
- **Output:** Merge commit SHA and success indicator.

### `delete_branch`

- **Description:** Deletes a remote branch. Strictly destructive; requires human confirmation.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `branch` (string, required): Branch name.
- **Output:** Deletion confirmation.
