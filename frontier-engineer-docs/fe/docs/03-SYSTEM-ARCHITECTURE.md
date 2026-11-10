# Part 03 — System Architecture

## 3.1 Architectural overview

Frontier Engineer consists of six layers.

```
┌──────────────────────────────────────────────────────────┐
│ Developer Interface                                      │
│ Natural-language requests and engineering reports        │
├──────────────────────────────────────────────────────────┤
│ Frontier Engineer — Coordinator                          │
│ Task classification · Planning · Delegation · Verification│
├──────────────────────────────────────────────────────────┤
│ Specialist Agent Layer                                   │
│ Architect · Implementation Engineer · Security Auditor · │
│ QA Engineer · Design Engineer                            │
├──────────────────────────────────────────────────────────┤
│ Skills and Rules — procedures and standards              │
├──────────────────────────────────────────────────────────┤
│ MCP and Tools — external capabilities                    │
├──────────────────────────────────────────────────────────┤
│ Project Environment                                      │
│ Source code · Terminal · Browser · Tests · Git           │
└──────────────────────────────────────────────────────────┘
```

## 3.2 Layer responsibilities

### Layer 1: Developer interface
Receives natural-language instructions, e.g.:

- Build a new authentication system.
- Debug this API.
- Review this pull request.
- Improve the dashboard UI.
- Audit the entire repository.

### Layer 2: Coordinator
The primary agent. It decides:

- What the developer is requesting
- Whether the request requires planning
- Which specialists are relevant
- Which skills should be activated
- Which files need inspection
- What verification is required
- Whether human approval is necessary

### Layer 3: Specialist agents
Handle focused engineering responsibilities. They must not independently expand the scope of the developer's request.

### Layer 4: Skills and rules
Skills contain detailed reusable engineering procedures. Rules establish persistent engineering standards.

### Layer 5: Tools and integrations
MCP servers and native Antigravity tools provide browser interaction, repository operations, documentation research, terminal execution, testing, and GitHub operations.

### Layer 6: Project environment
The actual repository and execution environment where engineering work happens.

## 3.3 Execution lifecycle

Every substantial engineering request follows this lifecycle:

```
Understand → Inspect → Classify → Plan → Approve (if needed)
     → Delegate → Implement → Verify → Review → Report
```

| Stage | Description |
| --- | --- |
| Understand | Interpret the request and constraints |
| Inspect | Read project instructions, source, configuration, and Git state |
| Classify | Assign a task category (see 3.4) |
| Plan | Produce a plan for non-trivial work |
| Approve | Pause for human approval on consequential actions |
| Delegate | Hand focused work to relevant specialists where supported |
| Implement | Make incremental, focused changes |
| Verify | Run relevant tests and checks |
| Review | Review quality and security implications |
| Report | Report changes, test outcomes, and limitations honestly |

## 3.4 Task classification

| Category | Example |
| --- | --- |
| Planning | Design a payment architecture |
| Implementation | Build a registration page |
| Debugging | Fix a broken API |
| Review | Review this code |
| Security | Audit authentication |
| Testing | Add integration tests |
| Research | Compare database technologies |
| UI/UX | Redesign the dashboard |
| Maintenance | Upgrade dependencies |
| Documentation | Write API documentation |

The classification determines which skills and specialists are relevant.

## 3.5 Delegation principles

Delegation should be selective:

- A small CSS adjustment does not require six agents.
- A payment system may require architecture, implementation, and security review.
- A complete application audit may require all specialist roles.
- A database migration may require architecture and database engineering review.

The coordinator must confirm the actual delegation capabilities provided by Antigravity rather than assume that defining agents makes them callable by one another.
