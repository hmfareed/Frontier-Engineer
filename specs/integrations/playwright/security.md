# Playwright Integration Security Policy

## Threat Model

Browser automation tools control a dynamic rendering engine capable of executing JavaScript, making network requests, and storing cookies. Key risks:

1. **Host Profile Pollution & Credential Hijacking:** Reading or corrupting the developer's personal browser profiles, cookies, saved passwords, or browsing sessions.
2. **Server-Side Request Forgery (SSRF) / Cloud Metadata Access:** Navigating the browser to internal cloud metadata IP addresses (`169.254.169.254`) or unintended internal subnets.
3. **Accidental Production Mutations:** Executing form submissions, checkouts, or data deletions against live production systems rather than local development environments.
4. **Credential and PII Exposure:** Injecting real user credentials, tokens, or personal data into browser form inputs.

## Defense-in-Depth Enforcement Boundaries

```text
┌─────────────────────────────────────────────────────────────────┐
│ Layer E: Human-in-the-Loop Approval                             │
│ External or staging form submissions require developer consent  │
├─────────────────────────────────────────────────────────────────┤
│ Layer D: Behavioral Rules (Frontier Engineer Rules System)      │
│ Prohibit real credentials; use only synthetic test fixtures     │
├─────────────────────────────────────────────────────────────────┤
│ Layer C: Network / Origin Restrictions                          │
│ Constrained to localhost, 127.0.0.1; cloud metadata blocked     │
├─────────────────────────────────────────────────────────────────┤
│ Layer B: Host / Antigravity Configuration Filtering             │
│ Registered dormant ("disabled": true) in mcp_config.json        │
├─────────────────────────────────────────────────────────────────┤
│ Layer A: Server-Level Isolation (--isolated & --headless)       │
│ Strict in-memory profiles; zero access to developer cookies     │
└─────────────────────────────────────────────────────────────────┘
```

### Layer A: In-Memory Profile Isolation

By passing `--isolated`, `@playwright/mcp` guarantees that the browser instance starts with a completely pristine, in-memory profile. It never reads from or writes to the developer's default browser profile directory (e.g., Chrome default profile or Edge user data), preventing any session leakage or persistent cookie exposure.

### Layer B: Host Configuration

Server is kept dormant (`"disabled": true`) in `mcp_config.json` until explicitly enabled by the developer.

### Layer C: Destination Restrictions

- Permitted: `http://localhost:*`, `http://127.0.0.1:*`, `http://[::1]:*`, and explicitly designated test staging origins.
- Prohibited: Cloud metadata endpoints (`169.254.169.254`), non-test public domains, internal network management interfaces.

### Layer D: Synthetic Fixture Policy

The agent is strictly prohibited from entering real passwords, API tokens, or personal identity numbers. All test interactions must use synthetic test fixtures (e.g., `test-user@example.com`, `synthetic-pass-123`).

### Layer E: Human Approval Gates

Interactions that cause remote state alterations outside local development servers require explicit developer confirmation.

## Audit Logging

Every navigation, interaction, and screenshot command is logged with:

- Target URL and origin verification
- Action type (`navigate`, `fill`, `click`, `screenshot`)
- Time elapsed and exit status
- Any uncaught console errors detected during the page lifecycle
