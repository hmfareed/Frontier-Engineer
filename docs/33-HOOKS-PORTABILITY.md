# Part 33 — Lifecycle hooks portability

## Platform portability architecture

Frontier Engineer maintains a strict distinction between platform-independent canonical specifications and platform-specific runtime adapters.

```text
┌─────────────────────────────────────────────────────────────────┐
│               CANONICAL SPECIFICATION LAYER                     │
│               specs/hooks/*.md (YAML + Markdown)                │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │ (scripts/generate-antigravity-hooks.ts)
                 ▼                               ▼
┌────────────────────────────────┐ ┌──────────────────────────────┐
│       ANTIGRAVITY ADAPTER      │ │   FUTURE PLATFORM ADAPTERS   │
│           hooks.json           │ │ (Claude Code, Cursor, Codex) │
│       (Supported - Phase 6)    │ │          (Planned)           │
└────────────────────────────────┘ └──────────────────────────────┘
```

## Platform capability matrix

| Capability / Event | Google Antigravity            | Claude Code               | Cursor              | OpenAI Codex    |
| ------------------ | ----------------------------- | ------------------------- | ------------------- | --------------- |
| Hook format        | `hooks.json` at root          | `.claude/hooks` (scripts) | Extension APIs      | Tool Wrappers   |
| `SessionStart`     | **Native** (`SessionStart`)   | Session preambles         | OnEditorOpen        | Session init    |
| `PreToolUse`       | **Native** (`PreToolUse`)     | Pre-tool hooks            | Tool middleware     | Proxy wrappers  |
| `PostToolUse`      | **Native** (`PostToolUse`)    | Post-tool hooks           | Tool middleware     | Proxy wrappers  |
| `PreInvocation`    | **Native** (`PreInvocation`)  | System prompt inject      | Context provider    | Prompt preamble |
| `PostInvocation`   | **Native** (`PostInvocation`) | Event subscriber          | Post-response event | Response logger |
| `Stop`             | **Native** (`Stop`)           | Session exit hook         | OnDeactivate        | Process cleanup |

## Portability discipline

- **Supported Adapter in Phase 6**: Google Antigravity is the only active target adapter in Phase 6.
- **Future Adapters**: Other platforms are marked `planned` in the canonical registry. No implementation is claimed or fabricated until official documentation and runtime environments are verified.
- **Core Policy Portability**: Because `command-classifier.ts` and `secret-redactor.ts` are pure TypeScript modules without Antigravity-specific dependencies, they can be directly reused inside future platform adapters.
