# Playwright Integration Security Policy

## Threat Model

Browser automation tools control a dynamic rendering engine capable of executing JavaScript, making network requests, and storing cookies. Key risks:

1. **Server-Side Request Forgery (SSRF) / Cloud Metadata Access:** Navigating the browser to internal cloud metadata IP addresses (`169.254.169.254`) or unintended internal subnets.
2. **Accidental Production Mutations:** Executing form submissions, checkouts, or data deletions against live production systems rather than local development environments.
3. **Credential and PII Exposure:** Injecting real user credentials, tokens, or personal data into browser form inputs or capturing sensitive session cookies in screenshots.
4. **Malicious DOM Injection:** Target web applications rendering untrusted user content designed to trigger prompt injection when read back through `query_dom_elements`.

## Sandbox Isolation and Domain Restrictions

- **Permitted URL Patterns:**
  - `http://localhost:*`
  - `http://127.0.0.1:*`
  - `http://[::1]:*`
  - Configured test staging domains explicitly matching `*.local`, `*.test`, or project staging hostnames.
- **Strictly Prohibited Destinations:**
  - Cloud metadata addresses (`http://169.254.169.254/*`).
  - Production applications or third-party web services unless explicitly authorized.
  - Public web domains not under developer test ownership.

## Credential and Data Sanitization

- **No Real Credentials:** The agent is strictly prohibited from entering real passwords, API tokens, or production credentials into form inputs. All test flows must use synthetic test fixtures (e.g., `test-user@example.com`, `dummy-password-1234`).
- **Screenshot Redaction:** Any screenshot captured containing accidentally surfaced API tokens or environment variables must be immediately deleted and replaced with a sanitized view.

## Headless Execution Policy

- **Headless Mode Enforced:** In automated or background execution contexts, the browser runs headlessly to prevent desktop display disruption and reduce resource footprint.
- **Resource Limits:** Browser processes enforce hard timeouts (15s max per operation) and memory caps to prevent browser-based Denial of Service.

## Audit Logging

Every navigation, interaction, and screenshot command is logged with:

- Target URL and origin verification
- Action type (`navigate`, `fill`, `click`, `screenshot`)
- Time elapsed and exit status
- Any uncaught console errors detected during the page lifecycle
