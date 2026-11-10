# Part 19 — Rule portability

## Cross-platform rules challenge

AI coding agent platforms have fragmented mechanisms for declaring and loading rules:

- **Google Antigravity:** Discovers rules from `rules/*.md` (one level deep). Supports YAML frontmatter with `trigger: "glob"` (`globs: "..."`), `trigger: "model_decision"` (`description: "..."`), or always-on rules without frontmatter.
- **Anthropic Claude Code:** Reads global project guidance from `CLAUDE.md` at the repository root, or modular rules under `.claude/rules/*.md`.
- **Cursor:** Reads root `.cursorrules` or modular MDC rule files under `.cursor/rules/*.mdc` with frontmatter defining description and glob filters.
- **OpenAI Codex:** Injects project instructions through system configuration or environment context files.

Directly coupling rule intelligence to any single platform's frontmatter conventions or directory structure would make the rules unmaintainable and non-portable.

## Canonical-first rules architecture

Frontier Engineer resolves platform fragmentation using a **canonical-first specification model**:

1. **Source of Truth (`specs/rules/`):**

   - Rules are authored in clean, platform-independent Markdown with a standardized frontmatter schema:

     ```yaml
     ---
     id: migration-safety
     name: Migration Safety Standards
     category: database
     triggerType: glob
     globs: "**/migrations/**,**/*.sql"
     description: Zero-downtime database migration rules, backward compatibility, lock minimization, and rollback safeguards.
     priority: 9
     enforcementLevel: mandatory
     platformConfig: {}
     ---
     ```

   - Rules are organized in logical domain categories (`engineering/`, `frontend/`, `backend/`, `database/`, `security/`, `testing/`, `performance/`).
   - Standardized sections are strictly required: `## Purpose`, `## Scope and applicability`, `## Core standards`, `## Invariants and prohibitions`, and `## Verification criteria`.

2. **Platform Adapters:**
   - Platform-specific generators compile canonical specifications into platform-compliant files.
   - For Google Antigravity, `scripts/generate-antigravity-rules.ts` emits flat files under `rules/<id>.md` and copies `specs/rules/AGENTS.md` to `rules/AGENTS.md`.
   - The generator translates `triggerType: glob` into Antigravity's `trigger: "glob"` and `triggerType: model_decision` into `trigger: "model_decision"`.

## Adapter mapping matrix

| Canonical Feature  | Google Antigravity                            | Anthropic Claude Code             | Cursor IDE                                      |
| :----------------- | :-------------------------------------------- | :-------------------------------- | :---------------------------------------------- |
| Global Foundation  | `rules/AGENTS.md`                             | `CLAUDE.md` / `.claude/rules/`    | `.cursorrules`                                  |
| File Path Trigger  | `rules/<id>.md` (`trigger: "glob"`)           | Path-referenced rule block        | `.cursor/rules/<id>.mdc` (`globs: "..."`)       |
| Intent Trigger     | `rules/<id>.md` (`trigger: "model_decision"`) | Description matching              | `.cursor/rules/<id>.mdc` (`description: "..."`) |
| Domain Hierarchy   | Flattened to `rules/*.md`                     | Flattened or nested in `.claude/` | Flattened in `.cursor/rules/`                   |
| Frontmatter Schema | `rule-frontmatter.schema.json`                | Platform-specific YAML            | Platform-specific MDC YAML                      |

## Future platform adapters

Because all rule intelligence, core standards, prohibitions, and verification criteria live in platform-independent canonical specifications, supporting future platforms requires only adding a new generator script (e.g. `scripts/generate-cursor-rules.ts` or `scripts/generate-claude-rules.ts`) without modifying the underlying rules.
