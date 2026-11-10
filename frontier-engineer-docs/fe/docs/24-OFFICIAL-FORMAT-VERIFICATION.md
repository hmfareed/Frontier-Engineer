# Part 24 — Official Format Verification Checklist (supplementary)

The specification repeatedly warns that Antigravity features must be verified, not assumed. This checklist is completed in **Phase 1** and every row must be filled with evidence (documentation URL, version, and date checked) before dependent phases start.

| # | Item to verify | Source consulted | Version / date | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Plugin manifest filename, location, and schema | | | | |
| 2 | Plugin root directory requirements | | | | |
| 3 | Agent definition format and metadata fields | | | | |
| 4 | Agent discovery locations | | | | |
| 5 | Delegation between agents (supported? how?) | | | | |
| 6 | Skill format (`SKILL.md`, frontmatter fields) | | | | |
| 7 | Skill discovery and activation behavior | | | | |
| 8 | Rule discovery locations and file names | | | | |
| 9 | MCP configuration file name and schema | | | | |
| 10 | Supported lifecycle hooks and event names | | | | |
| 11 | Supported CLI commands (install, validate, list) | | | | |
| 12 | Marketplace or distribution requirements | | | | |
| 13 | Persistent memory features (if any) | | | | |

## Result values

- **Confirmed** — documented and tested locally
- **Documented only** — in official docs but not yet tested
- **Not supported** — implement via workflow or script instead
- **Unclear** — blocked; escalate to the developer

## Rules

- Record the exact URL and date for each source.
- Prefer official documentation over blog posts or other agent platforms' docs.
- If an item is **Not supported**, document the fallback (see `09-HOOKS-AND-AUTOMATION.md`, section 9.3).
