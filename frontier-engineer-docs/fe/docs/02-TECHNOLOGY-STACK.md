# Part 02 — Technology Stack

Frontier Engineer uses a lightweight, maintainable stack that works naturally with Antigravity. The system itself does **not** need a separate Next.js application, MongoDB database, or React dashboard.

## 2.1 Core stack

| Technology | Purpose |
| --- | --- |
| Google Antigravity | Agent execution environment |
| Gemini | Underlying AI model |
| Markdown | Agent instructions, skills, rules, documentation |
| YAML | Metadata and configuration where supported |
| JSON | Structured configuration |
| TypeScript | Supporting automation and validation scripts |
| Node.js LTS | Helper script runtime |
| npm | Dependency management |
| Git | Version control |
| GitHub | Repository hosting and releases |

## 2.2 Development dependencies

| Dependency | Purpose |
| --- | --- |
| TypeScript | Type checking helper scripts |
| Vitest | Unit testing |
| Ajv | JSON Schema validation |
| YAML | YAML parsing |
| Prettier | Formatting |
| markdownlint-cli2 | Markdown quality checks |
| Playwright | Browser automation and UI testing where appropriate |
| ESLint | JavaScript and TypeScript linting |

Use compatible, maintained versions and lock them through the package lockfile.

## 2.3 Why TypeScript?

TypeScript supports tooling only; it does not replace Antigravity's native agent system. It provides:

- Configuration validation
- Metadata verification
- File and directory validation
- Security checks
- Automated documentation checks
- Test utilities
- Packaging helpers

## 2.4 Why Markdown?

Agent instructions, skills, and engineering rules are naturally Markdown documents. This makes the system easy to inspect, easy to customize, version-controllable, portable, and understandable to developers.

## 2.5 External integrations

Optionally supported:

- Playwright MCP
- GitHub MCP
- Context7
- Chrome DevTools MCP

Each integration must be independently configurable. Do not assume every Antigravity installation supports every integration in the same way; verify the current official configuration format before implementing (see `24-OFFICIAL-FORMAT-VERIFICATION.md`).
