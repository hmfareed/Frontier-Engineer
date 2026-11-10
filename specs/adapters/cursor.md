# Cursor adapter — NOT IMPLEMENTED

**Status:** NOT IMPLEMENTED. This document records compatibility requirements only. No adapter file exists, no format has been verified for this project, and no compatibility is claimed.

## Why it is not implemented

Phase 2 implements the Antigravity adapter only. Cursor's rule/agent discovery, frontmatter conventions, and any delegation capability must be verified against current official documentation before an adapter is generated. The project explicitly forbids assuming that formats from other agent platforms are compatible.

## Compatibility requirements to verify

| Requirement              | Question to answer before implementing                                                |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Agent or mode definition | Does the platform support named custom agents, or only persistent rules and modes?    |
| Discovery                | Which directories and file extensions are scanned, and at what scope?                 |
| Metadata                 | Which frontmatter keys and activation triggers are supported?                         |
| Delegation               | Can a primary agent spawn or switch to a specialist, and is context isolated?         |
| Tool restrictions        | Can capabilities be limited per agent, and what are the exact identifiers?            |
| Rules and skills         | How do project rules and reusable instructions map to the canonical capability model? |
| Handoff transport        | Can the structured handoff contract be passed between roles?                          |

## Features that may not translate directly

- Independent concurrent subagents with per-agent model tiers.
- `mainAgent` / `subagent` role separation.
- Parent-controlled cancellation, message-based re-awakening, and nesting limits.
- Plugin-level namespacing and a single distributable bundle.

If the platform exposes only persistent rules, the honest fallback is a role-based prompt workflow coordinated by the lead agent, documented as a workflow rather than as native multi-agent orchestration.

## Implementation rule

Build this adapter from [the canonical specifications](../agents/) using the shared [adapter contract](README.md). Do not duplicate agent instructions. Mark it implemented only after discovery and invocation have been tested locally.
