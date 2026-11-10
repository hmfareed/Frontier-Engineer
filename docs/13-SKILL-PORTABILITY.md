# Part 13 — Skill Portability and Cross-Platform Translation

## Portability principles

Frontier Engineer's intelligence is designed to be **portable across AI coding agent platforms**.
To achieve this without degrading quality or maintaining multiple fragmented copies of instructions:

1. **Canonical Specifications:** All skill intelligence lives in platform-neutral Markdown files under `specs/skills/` with zero platform-specific metadata (`platformConfig: {}`).
2. **Platform Translation via Adapters:** A platform adapter translates canonical skills into the format, directory structure, and frontmatter required by the target platform.
3. **No Presumed Equivalence:** Markdown readability alone does not prove platform compatibility. Platforms differ significantly in how skills are discovered, triggered, scoped, and executed.

---

## Target platform comparison matrix

| Feature / Dimension             | Google Antigravity                            | Claude Code                                | OpenAI Codex                               | Cursor                                     | Windsurf                                   |
| :------------------------------ | :-------------------------------------------- | :----------------------------------------- | :----------------------------------------- | :----------------------------------------- | :----------------------------------------- |
| **Skill Location**              | `skills/<name>/SKILL.md`                      | `.claude/skills/<name>/SKILL.md`           | `.codex/skills/` or instructions           | `.cursor/rules/` or prompts                | `.windsurf/rules/`                         |
| **Format**                      | Markdown with YAML frontmatter                | Markdown / YAML frontmatter                | Prompt instructions                        | Markdown / `.mdc` files                    | Markdown / rules                           |
| **Required Metadata**           | `name`, `description`                         | `name`, `description`                      | Varies / unstructured                      | Glob patterns, description                 | Trigger metadata                           |
| **Progressive Disclosure**      | Supported (subdirectories like `references/`) | Partially supported                        | Not natively supported                     | Context inclusion rules                    | Context inclusion rules                    |
| **Discovery Mechanism**         | Startup directory scan + semantic match       | Subcommand / agent scan                    | Prompt injection                           | Glob match on active file                  | Glob match on active file                  |
| **Status in Frontier Engineer** | **Implemented & Verified**                    | **Requirements Defined (Not Implemented)** | **Requirements Defined (Not Implemented)** | **Requirements Defined (Not Implemented)** | **Requirements Defined (Not Implemented)** |

---

## Detailed platform considerations

### 1. Google Antigravity (Implemented & Verified)

- **Convention:** Plugin root contains `skills/<skill_name>/SKILL.md`.
- **Frontmatter:** Requires `name` (matching directory name) and `description`.
- **Progressive Disclosure:** Officially supports `references/` subdirectory relative to `SKILL.md`.
- **Validation:** Verified using official CLI: `agy plugin validate --strict .` recognizes all 10 skills with 0 findings.

### 2. Claude Code (Unimplemented)

- **Adapter Requirements:** Requires mapping canonical skills into `.claude/skills/` or plugin bundles.
- **Differences:** Does not share Antigravity's exact plugin manifest structure; requires verifying tool execution permissions.

### 3. OpenAI Codex (Unimplemented)

- **Adapter Requirements:** Requires compiling skills into consolidated system instructions or modular role definitions.
- **Differences:** No native multi-directory plugin packaging or progressive disclosure subdirectories.

### 4. Cursor (Unimplemented)

- **Adapter Requirements:** Requires mapping skills to Cursor rules (`.cursor/rules/*.mdc`) with explicit file glob matching or semantic triggers.
- **Differences:** Cursor rules are typically associated with file patterns (`globs: "**/*.tsx"`) rather than task-oriented agent subcommands.

### 5. Windsurf (Unimplemented)

- **Adapter Requirements:** Requires mapping skills to Cascade memory rules or workflows.
- **Differences:** Cascade operates as a single conversational agent with memory files rather than a primary coordinator delegating to subagents.

---

## Portability rules

1. Never claim a non-Antigravity skill adapter works until it has been implemented and tested in that platform's environment.
2. Canonical skill specifications in `specs/skills/` must remain completely free of vendor-specific keys.
3. Unimplemented platform adapter documents in `specs/adapters/` must retain the explicit label `NOT IMPLEMENTED`.
