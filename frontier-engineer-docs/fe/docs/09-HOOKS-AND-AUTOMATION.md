# Part 09 — Hooks and Automation

Hooks can provide event-driven safeguards, but **only if** the installed Antigravity version officially supports the relevant events and configuration. Do not assume every event from Claude Code, Cursor, or another agent framework exists in Antigravity.

## 9.1 Potential hook responsibilities

Where supported: session initialization, context checks, pre-execution validation, post-execution verification, logging, policy enforcement, completion checks.

## 9.2 Suggested safeguards

### Before modifying project files
- Check the repository's instructions
- Check the current Git state
- Identify relevant files
- Detect potential generated or sensitive files

### Before terminal execution
- Inspect potentially destructive commands
- Identify production targets
- Require approval where necessary

### After implementation
- Run relevant validation
- Check for accidental secret exposure
- Confirm the changed files
- Report failed checks

## 9.3 Important implementation rule

If a desired safeguard cannot be implemented using supported native hooks, implement it through a documented workflow, validation script, or agent instruction instead. **Do not invent a hook API.**
