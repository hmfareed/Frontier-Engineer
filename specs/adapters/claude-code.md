# Claude Code adapter — NOT IMPLEMENTED

**Status:** NOT IMPLEMENTED. This document records compatibility requirements only. No adapter file exists, no format has been verified for this project, and no compatibility is claimed.

## Why it is not implemented

Phase 2 implements the Antigravity adapter only, as required. Exact Claude Code subagent file locations, frontmatter keys, tool allowlist syntax, and delegation semantics must be verified against current official documentation before an adapter is written. Copying assumptions from another agent platform is explicitly prohibited by the project's engineering rules.

## Compatibility requirements to verify

| Requirement               | Question to answer before implementing                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| Agent definition location | Where are project-scoped and user-scoped subagent definitions discovered from?                  |
| Definition format         | Which file extension, frontmatter keys, and body conventions are supported?                     |
| Delegation                | How does a primary agent invoke a named subagent, and is concurrency supported?                 |
| Tool restrictions         | Can per-agent tool allowlists be expressed, and what are the exact identifiers?                 |
| Context isolation         | Does a subagent inherit the parent conversation, rules, and MCP servers?                        |
| Rules and skills          | How do persistent rules and reusable skills map onto the canonical capability model?            |
| Handoff transport         | Can the structured handoff contract be carried as the subagent prompt and returned as a result? |

## Features that may not translate directly

- Antigravity's `mainAgent` / `subagent` split and `invoke_subagent` lifecycle.
- `commandExecutionPolicy` sandbox semantics.
- Parent-controlled cancellation, idle re-awakening, and the 10-level nesting limit.
- Plugin-level namespacing of skills and MCP servers.

## Implementation rule

Build this adapter from [the canonical specifications](../agents/) using the shared [adapter contract](README.md). Do not duplicate agent instructions. Mark it implemented only after discovery and invocation have been tested locally.
