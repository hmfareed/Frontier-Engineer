# Part 12 — Planning and Execution

## 12.1 Task decomposition

Divide complex requests into smaller deliverables. Example: build authentication.

```
Authentication System
│
├── Requirements
│   ├── User registration
│   ├── Login
│   ├── Logout
│   └── Password recovery
│
├── Architecture
│   ├── User model
│   ├── Session strategy
│   └── API contracts
│
├── Implementation
│   ├── Registration
│   ├── Login
│   ├── Session management
│   └── Recovery
│
├── Security
│   ├── Password hashing
│   ├── Authorization
│   └── Rate limiting
│
└── Verification
    ├── Unit tests
    ├── Integration tests
    └── Security tests
```

## 12.2 Planning requirements

Every substantial plan contains: objective, existing system analysis, scope, non-goals, technical decisions, files affected, dependencies, implementation steps, security implications, testing requirements, acceptance criteria, risks.

## 12.3 Execution modes

| Mode | Behavior |
| --- | --- |
| Advisory | Analyze and recommend without editing |
| Assisted | Plan and implement with appropriate approvals |
| Verification | Review, test, audit, and report |

These are workflow policies, not claims that Antigravity has native mode-switching APIs for them.

## 12.4 Progress tracking

For long-running tasks, maintain a clear checklist.

```markdown
# Implementation Progress

- [x] Requirements analyzed
- [x] Architecture approved
- [x] Database schema created
- [ ] API implementation
- [ ] Frontend integration
- [ ] Security review
- [ ] Integration tests
- [ ] Final verification
```

Do not mark tasks complete without evidence.
