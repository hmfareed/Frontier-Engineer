# Codex adapter — NOT IMPLEMENTED

**Status:** NOT IMPLEMENTED. This document records compatibility requirements only. No adapter file exists, no format has been verified for this project, and no compatibility is claimed.

## Why it is not implemented

Phase 2 implements the Antigravity adapter only. Codex agent definition formats, discovery paths, delegation primitives, and tool permission syntax must be verified against current official documentation before any adapter is generated.

## Compatibility requirements to verify

| Requirement               | Question to answer before implementing                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| Agent definition location | Does the platform support named, reusable project-scoped agents, and where are they stored? |
| Definition format         | What manifest, frontmatter, or configuration keys are supported?                            |
| Delegation                | Is there a native multi-agent delegation primitive equivalent to `invoke_subagent`?         |
| Approval model            | How are destructive commands, external writes, and production actions gated?                |
| Sandboxing                | Which execution policies exist, and how do they map to `commandExecutionPolicy: sandbox`?   |
| Rules and skills          | How are persistent instructions and reusable procedures discovered?                         |
| Handoff transport         | Can the structured handoff contract survive a delegation round trip?                        |

## Features that may not translate directly

- Native named subagents with independent model tiers and clean contexts.
- Concurrent specialist execution with parent-side reconciliation.
- Plugin-level packaging of agents, rules, skills, and MCP servers as one unit.
- A `mainAgent`-style primary-agent selector.

If no native delegation primitive exists, the fallback is a documented sequential workflow in which the coordinator prompts one specialist at a time and carries the handoff contract explicitly. That fallback must be labelled as a workflow, not as native orchestration.

## Implementation rule

Build this adapter from [the canonical specifications](../agents/) using the shared [adapter contract](README.md). Do not duplicate agent instructions. Mark it implemented only after discovery and invocation have been tested locally.
