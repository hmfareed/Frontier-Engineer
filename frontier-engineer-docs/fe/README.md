# Frontier Engineer — Specification

AI-powered software engineering agent system for Google Antigravity. This folder holds the complete technical specification, split into one Markdown file per part.

## Documentation index

| Part | Document | Coverage |
| --- | --- | --- |
| 01 | [Project Overview](docs/01-PROJECT-OVERVIEW.md) | Vision, objectives, scope, requirements |
| 02 | [Technology Stack](docs/02-TECHNOLOGY-STACK.md) | Languages, tools, frameworks, dependencies |
| 03 | [System Architecture](docs/03-SYSTEM-ARCHITECTURE.md) | Core architecture, execution lifecycle |
| 04 | [Agent System](docs/04-AGENT-SPECIFICATIONS.md) | Six specialist agents and responsibilities |
| 05 | [Skills System](docs/05-SKILLS-SPECIFICATIONS.md) | Ten reusable engineering skills |
| 06 | [Engineering Rules](docs/06-ENGINEERING-RULES.md) | Global and project-specific standards |
| 07 | [MCP Integrations](docs/07-MCP-INTEGRATIONS.md) | External tools and integrations |
| 08 | [Security and Permissions](docs/08-SECURITY-AND-PERMISSIONS.md) | Safety, access, secrets, approval policies |
| 09 | [Hooks and Automation](docs/09-HOOKS-AND-AUTOMATION.md) | Lifecycle events and guardrails |
| 10 | [Project Intelligence](docs/10-PROJECT-INTELLIGENCE.md) | Repository analysis and understanding |
| 11 | [Engineering Memory](docs/11-ENGINEERING-MEMORY.md) | Persistent decisions and context |
| 12 | [Planning and Execution](docs/12-PLANNING-AND-EXECUTION.md) | Task decomposition and implementation |
| 13 | [Testing and Quality](docs/13-TESTING-AND-QUALITY.md) | Verification, testing, evaluations |
| 14 | [User Experience](docs/14-USER-EXPERIENCE.md) | Agent communication and reporting |
| 15 | [Repository Structure](docs/15-REPOSITORY-STRUCTURE.md) | Complete directory specification |
| 16 | [Installation and Configuration](docs/16-INSTALLATION-AND-CONFIGURATION.md) | Setup and usage |
| 17 | [Development Roadmap](docs/17-DEVELOPMENT-ROADMAP.md) | Implementation phases |
| 18 | [Testing and Acceptance](docs/18-TESTING-AND-ACCEPTANCE.md) | Release criteria |
| 19 | [Versioning and Distribution](docs/19-VERSIONING-AND-DISTRIBUTION.md) | Releases and maintenance |
| 20 | [Troubleshooting](docs/20-TROUBLESHOOTING.md) | Common failures and resolutions |
| 21 | [Coding Agent Instructions](docs/21-CODING-AGENT-INSTRUCTIONS.md) | Master implementation prompt and phase prompts |
| 22 | [Future Development](docs/22-FUTURE-DEVELOPMENT.md) | Advanced capabilities |

### Supplementary documents (added)

| Part | Document | Purpose |
| --- | --- | --- |
| 23 | [Glossary](docs/23-GLOSSARY.md) | Shared terminology |
| 24 | [Official Format Verification](docs/24-OFFICIAL-FORMAT-VERIFICATION.md) | Phase 1 checklist for Antigravity features |
| 25 | [Templates Reference](docs/25-TEMPLATES.md) | Reports, ADRs, approval requests, findings |
| 26 | [Evaluation Suite](docs/26-EVALUATION-SUITE.md) | How the 85/100 target is measured |

## How to use

1. Read Parts 01–03 for the vision and architecture.
2. Give Part 21's master prompt to the Antigravity coding agent, then the phase prompts one at a time.
3. Complete Part 24 during Phase 1 before building anything that depends on Antigravity-specific formats.
