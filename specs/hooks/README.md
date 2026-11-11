# Canonical Lifecycle Hooks Specifications

This directory houses the canonical, platform-independent specifications for the Frontier Engineer Lifecycle Hooks System.

## Architecture Principles

Frontier Engineer adheres to a canonical-first architecture where behavioral guarantees, security policies, and execution contracts are defined platform-agnostically in canonical specifications, and then compiled into platform-specific configuration files (such as Antigravity `hooks.json`).

1. **Point of Action**: Safeguards operate at the point of action rather than relying solely on instructions in system prompts.
2. **Predictable & Minimal**: Handlers are focused, predictable, and maintainable without introducing background daemons or secondary agent loops.
3. **Fail-Safe Protocol**: Strict input/output contracts prevent corrupted state and handle crashes gracefully.
4. **Data Privacy**: All diagnostics and execution logs enforce strict secret redaction and bounded file retention.

## Specification Files

- [hook-registry.md](./hook-registry.md) — The central canonical registry of all lifecycle hooks.
- [hook-security-model.md](./hook-security-model.md) — The operational trust model, threat matrix, and fail-safe policy.
- [session-start.md](./session-start.md) — Session initialization hook (`frontier-session-init`).
- [pre-tool-use.md](./pre-tool-use.md) — Pre-tool safety gating hook (`frontier-pre-tool-safety`).
- [post-tool-use.md](./post-tool-use.md) — Post-tool execution auditing hook (`frontier-post-tool-audit`).
- [pre-invocation.md](./pre-invocation.md) — Engineering context injection hook (`frontier-engineering-context`).
- [post-invocation.md](./post-invocation.md) — Invocation lifecycle diagnostics hook (`frontier-invocation-audit`).
- [stop.md](./stop.md) — Session stop and finalization hook (`frontier-session-stop`).
