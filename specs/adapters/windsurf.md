# Windsurf adapter — NOT IMPLEMENTED

**Status:** NOT IMPLEMENTED. This document records compatibility requirements only. No adapter file exists, no format has been verified for this project, and no compatibility is claimed.

## Why it is not implemented

Phase 2 implements the Antigravity adapter only. Windsurf's agent, rule, and workflow formats must be verified against current official documentation before an adapter is generated. No unverified compatibility is asserted.

## Compatibility requirements to verify

| Requirement      | Question to answer before implementing                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Agent definition | Are named custom agents or roles supported, and how are they declared?                         |
| Discovery        | Which directories, file names, and scopes are read?                                            |
| Metadata         | What frontmatter or configuration keys control activation and tool access?                     |
| Delegation       | Is there a native delegation primitive, and does it isolate context?                           |
| Workflows        | How do saved workflows differ from reusable skills, and can either carry the handoff contract? |
| Approval model   | How are destructive operations and external writes gated?                                      |
| Rules and skills | How are persistent instructions and procedures discovered?                                     |

## Features that may not translate directly

- Native parallel subagents with clean contexts and independent model tiers.
- `mainAgent` / `subagent` role separation and a primary-agent selector.
- Message-based inter-agent communication and nesting limits.
- A single versioned plugin bundling agents, rules, skills, hooks, and MCP servers.

If native delegation is unavailable, the fallback is a documented sequential role workflow in which the coordinator carries the handoff contract explicitly. It must be labelled as a workflow, not as native orchestration.

## Implementation rule

Build this adapter from [the canonical specifications](../agents/) using the shared [adapter contract](README.md). Do not duplicate agent instructions. Mark it implemented only after discovery and invocation have been tested locally.
