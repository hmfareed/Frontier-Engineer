# GitHub Integration Capabilities

This document specifies the tools, operations, and parameters supported by the official GitHub MCP integration (`github/github-mcp-server`) under Frontier Engineer's least-privilege configuration.

## Permission Class Summary

Under Frontier Engineer's hardened configuration (`--read-only=true`), all exposed tools are strictly **Read-only**:

| Tool Name            | Permission Class | Target Scope                 | Human Confirmation Required | Agent Affinity                                                |
| :------------------- | :--------------- | :--------------------------- | :-------------------------- | :------------------------------------------------------------ |
| `get_file_contents`  | Read-only        | Remote repository file       | No                          | `frontier-engineer`, `implementation-engineer`                |
| `get_issue`          | Read-only        | Target issue details         | No                          | `frontier-engineer`, `qa-engineer`                            |
| `list_issues`        | Read-only        | Repository issues catalog    | No                          | `frontier-engineer`, `qa-engineer`                            |
| `get_pull_request`   | Read-only        | Pull request metadata & diff | No                          | `frontier-engineer`, `qa-engineer`, `implementation-engineer` |
| `list_pull_requests` | Read-only        | Pull request catalog         | No                          | `frontier-engineer`, `qa-engineer`                            |
| `list_commits`       | Read-only        | Commit history               | No                          | `frontier-engineer`, `implementation-engineer`                |
| `search_code`        | Read-only        | Remote code search           | No                          | `frontier-engineer`, `architect`, `implementation-engineer`   |
| `search_issues`      | Read-only        | Remote issue/PR search       | No                          | `frontier-engineer`, `qa-engineer`                            |

## Disabled Operations (Server-Enforced)

The official `github-mcp-server` `--read-only=true` flag actively disables the following tools at the binary boundary:

- `create_issue` / `update_issue`: Disabled (writes must be managed via web or CLI).
- `create_pull_request` / `update_pull_request`: Disabled (PR creation belongs to developer review).
- `merge_pull_request`: Disabled (merging remote branches via LLM is blocked).
- `delete_branch`: Disabled (destructive deletion blocked).
- `push_files`: Disabled (local git CLI commits are used instead).

## Tool Specifications

### `get_file_contents`

- **Description:** Reads file contents from a specific commit, branch, or tag in the remote repository.
- **Parameters:**
  - `owner` (string, required): Repository owner or organization.
  - `repo` (string, required): Repository name.
  - `path` (string, required): Relative file path.
  - `ref` (string, optional): Branch name, tag, or commit SHA.
- **Output:** Decoded text content or structured directory listing.

### `get_issue`

- **Description:** Retrieves details, status, labels, and discussion thread for a GitHub issue.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `issue_number` (integer, required): Issue number.
- **Output:** Structured issue object including state, author, labels, and body.

### `list_issues`

- **Description:** Lists issues in a repository filtered by state or milestone.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `state` (string, optional): `open`, `closed`, or `all`.
  - `labels` (array of strings, optional): Filter labels.
- **Output:** Array of issue summaries.

### `get_pull_request`

- **Description:** Fetches pull request review state, metadata, and diff.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `pull_number` (integer, required): Pull request number.
- **Output:** Structured pull request metadata and patch status.

### `list_pull_requests`

- **Description:** Lists pull requests in a repository with state filtering.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `state` (string, optional): `open`, `closed`, or `all`.
- **Output:** Array of pull request summaries.

### `list_commits`

- **Description:** Retrieves commit log for a branch, tag, or file path.
- **Parameters:**
  - `owner` (string, required): Repository owner.
  - `repo` (string, required): Repository name.
  - `sha` (string, optional): Branch name or commit SHA.
- **Output:** Array of commit objects with commit messages and authors.

### `search_code`

- **Description:** Searches code across accessible repositories using GitHub code search syntax.
- **Parameters:**
  - `query` (string, required): Search query string.
  - `page` (integer, optional): Results page.
- **Output:** List of matching file paths, snippets, and repository links.

### `search_issues`

- **Description:** Searches issues and pull requests by keyword or qualifier.
- **Parameters:**
  - `query` (string, required): Search query.
- **Output:** List of matching issue and pull request references.
