# Part 01 — Project Overview

## 1.1 Project identity

- **Product name:** Frontier Engineer
- **Category:** AI-powered software engineering agent system
- **Primary environment:** Google Antigravity
- **Primary model environment:** Gemini models supported by Antigravity
- **Architecture:** Multi-agent engineering system with reusable skills, persistent rules, external tool integrations, and automated verification
- **Primary objective:** Transform a general-purpose AI coding agent into a structured, disciplined, high-capability software engineering system

## 1.2 Vision

Frontier Engineer aims to provide an experience comparable to having an experienced engineering team alongside the developer. Instead of one general-purpose agent doing everything, work is organized across specialist agents, each with defined responsibilities, procedures, quality standards, and boundaries.

The system should be able to:

- Understand unfamiliar codebases
- Design scalable application architectures
- Plan complex software projects
- Implement frontend and backend features
- Design and manage databases
- Debug complicated failures
- Identify security vulnerabilities
- Conduct code reviews
- Write and execute tests
- Analyze application performance
- Research unfamiliar technologies
- Inspect rendered interfaces
- Produce technical documentation
- Verify implementations before reporting completion

## 1.3 Core philosophy

1. **Engineering before code generation** — understand requirements and existing architecture before modifying files.
2. **Evidence before assumptions** — inspect actual source files, configurations, dependencies, and execution results rather than inventing project details.
3. **Verification before completion** — a feature is not "implemented" just because code was generated.
4. **Security by default** — authentication, authorization, validation, data protection, and secure configuration are considered throughout.
5. **Maintainability over shortcuts** — prefer clear architecture, reusable components, separation of concerns, and understandable implementations.
6. **Human control** — developers retain control over destructive operations, production deployments, sensitive configuration, and consequential decisions.
7. **Continuous improvement** — the system evaluates its own results and improves its instructions, workflows, and quality standards.

## 1.4 Project objectives

The first major release must achieve:

| Objective | Expected result |
| --- | --- |
| Multi-agent engineering | Specialized agents with clear responsibilities |
| Repository intelligence | Understand existing project structures |
| Architecture planning | Produce implementation-ready designs |
| Software implementation | Work across frontend and backend |
| Security auditing | Identify common application vulnerabilities |
| Testing | Run and report appropriate tests |
| Debugging | Investigate and resolve defects systematically |
| UI engineering | Produce polished, accessible interfaces |
| Research | Retrieve current technical documentation |
| Documentation | Generate and maintain useful technical documents |

## 1.5 Non-goals

Frontier Engineer is not intended to:

- Change Gemini's underlying model weights
- Guarantee that every generated implementation is correct
- Replace human engineering judgment
- Automatically deploy every change to production
- Execute unrestricted shell commands
- Replace every existing development tool
- Depend on a custom SaaS backend for its core functionality

It improves the engineering workflow through better orchestration, instructions, integrations, and verification.

## 1.6 Target users

- Independent software developers
- Full-stack engineers
- Frontend and backend engineers
- Technical founders
- Engineering teams
- Developers maintaining complex applications
- Developers building production-grade SaaS products

## 1.7 Expected product experience

A developer enters a request such as:

> Audit my existing application, identify architectural weaknesses, inspect security, evaluate performance, and provide a prioritized improvement plan.

Frontier Engineer should:

1. Inspect the repository
2. Understand the technology stack
3. Identify application entry points
4. Examine architectural boundaries
5. Inspect dependencies
6. Evaluate authentication and authorization
7. Examine API implementation
8. Review database structure
9. Inspect frontend quality
10. Identify missing tests
11. Delegate specialist reviews where supported
12. Consolidate findings
13. Produce a prioritized engineering report

It must **not** start rewriting the entire application without authorization.
