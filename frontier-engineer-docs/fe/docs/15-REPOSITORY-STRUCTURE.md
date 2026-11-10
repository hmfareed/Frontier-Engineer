# Part 15 — Repository Structure

The proposed source repository structure. Exact Antigravity plugin packaging requirements must be checked against its current official documentation before finalizing the plugin root.

```
frontier-engineer/
│
├── README.md
├── LICENSE
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── .gitignore
│
├── plugin.json
│
├── agents/
│   ├── frontier-engineer.md
│   ├── architect.md
│   ├── implementation-engineer.md
│   ├── security-auditor.md
│   ├── qa-engineer.md
│   └── design-engineer.md
│
├── skills/
│   ├── architecture/
│   │   ├── SKILL.md
│   │   └── references/
│   ├── debugging/
│   │   ├── SKILL.md
│   │   └── references/
│   ├── security-audit/
│   │   └── SKILL.md
│   ├── code-review/
│   │   └── SKILL.md
│   ├── frontend-engineering/
│   │   └── SKILL.md
│   ├── backend-engineering/
│   │   └── SKILL.md
│   ├── testing/
│   │   └── SKILL.md
│   ├── deep-research/
│   │   └── SKILL.md
│   ├── database-engineering/
│   │   └── SKILL.md
│   └── performance-engineering/
│       └── SKILL.md
│
├── rules/
│   ├── AGENTS.md
│   ├── engineering-standards.md
│   ├── security-standards.md
│   ├── testing-standards.md
│   └── frontend-standards.md
│
├── scripts/
│   ├── validate-plugin.ts
│   ├── validate-frontmatter.ts
│   ├── check-links.ts
│   └── policy/
│       └── protected-commands.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│
├── docs/
│   ├── 01-PROJECT-OVERVIEW.md
│   ├── ... (22 core documents, plus 23-26 supplementary)
│   └── 22-FUTURE-DEVELOPMENT.md
│
└── .github/
    └── workflows/
        ├── validate.yml
        └── release.yml
```

Optional files such as `mcp_config.json` and `hooks.json` should only be added if the official plugin format supports them at the relevant location.

> **Note:** Part 21 also calls for backend and database rules and documentation standards. Add `backend-standards.md`, `database-standards.md`, and `documentation-standards.md` under `rules/` when implementing Phase 4.
