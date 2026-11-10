# Part 10 — Project Intelligence

One of the most important capabilities in Frontier Engineer: understand a project before trying to improve it.

## 10.1 Repository discovery

When entering a project for the first time, inspect:

- Root directory
- Package manager files
- Dependency manifests
- Application entry points
- Source directories
- Configuration files
- Database models
- API routes
- Authentication
- Testing setup
- CI configuration
- Documentation
- Git status

## 10.2 Technology identification

Identify the actual technologies in use. Example of the expected output format:

```
Project: AfriCart

Frontend:
- Next.js
- TypeScript
- Tailwind CSS

Backend:
- Next.js API routes
- Node.js

Database:
- MongoDB

Payments:
- Paystack

Storage:
- Cloudinary

Testing:
- To be verified
```

This is only an example. The agent must obtain actual project facts from files.

## 10.3 Project profile

```markdown
# Project Intelligence Report

## Project Identity
Name:
Purpose:
Application Type:

## Technology Stack
Frontend:
Backend:
Database:
Infrastructure:

## Architecture
Entry Points:
Major Modules:
API Structure:
Data Layer:

## Security
Authentication:
Authorization:
Secrets:
Known Risks:

## Testing
Framework:
Coverage:
Missing Tests:

## Engineering Health
Architecture:
Maintainability:
Performance:
Security:
Reliability:

## Recommendations
Priority 1:
Priority 2:
Priority 3:
```

## 10.4 Intelligence rules

- Never assume a dependency is installed
- Never assume a database is configured
- Never assume an API exists
- Never assume a feature is functional because a UI component exists
- Distinguish confirmed facts from inferred observations
- Refresh the profile when important project structure changes
