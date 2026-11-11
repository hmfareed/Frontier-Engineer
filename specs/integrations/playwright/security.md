# Playwright Integration Security Policy

## Threat Model

Browser automation tools control a dynamic rendering engine capable of executing JavaScript, making network requests, and storing state. Key risks:

1. **Host Profile Pollution & Credential Hijacking:** Reading or corrupting the developer's personal browser profiles, cookies, saved passwords, or browsing sessions.
2. **Server-Side Request Forgery (SSRF) / Cloud Metadata Access:** Navigating the browser to internal cloud metadata IP addresses (`169.254.169.254`) or unintended internal subnets.
3. **Accidental Production Mutations:** Executing form submissions, checkouts, or data deletions against live production systems rather than local development environments.
4. **Credential and PII Exposure:** Injecting real user credentials, tokens, or personal data into browser form inputs.
5. **Arbitrary File Access on Host:** The host process reading or writing arbitrary files outside intended test artifacts.

---

## Technical Security Boundaries: The Six Dimensions

To ensure complete technical precision, Frontier Engineer separates browser behavioral controls from host operating system security. The system explicitly distinguishes six distinct dimensions:

### 1. Browser Profile Isolation

- **Mechanism:** Passing `--isolated` to `@playwright/mcp`.
- **Scope & Meaning:** Enforces a clean, in-memory `BrowserContext` for the session. It starts with zero cookies, zero localStorage/IndexedDB entries, and zero saved authentication tokens. When the process terminates, all session state is discarded.
- **Limitation:** It guarantees that the agent cannot read or alter the developer's personal Chrome/Edge/Firefox profiles. It does **not** restrict host process capabilities or provide an operating-system sandbox.

### 2. Browser Process Isolation

- **Mechanism:** Chromium multi-process architecture.
- **Scope & Meaning:** Chromium separates the browser engine, network service, and renderer processes. Rendering tabs run in isolated renderer processes with site isolation.
- **Limitation:** While renderer processes isolate website scripts from each other, the overarching Node.js process and Playwright controller run as the host developer user.

### 3. Operating-System Sandboxing

- **Mechanism:** Chromium platform sandboxes (seccomp-bpf on Linux, AppContainer/Token restriction on Windows).
- **Scope & Meaning:** Chromium limits the syscall surface of untrusted renderer processes.
- **Limitation:** The Node.js MCP server process itself is **not** sandboxed by default and executes with standard developer shell permissions. Do not assume or claim that Playwright is barred from host system execution unless running inside a separate Docker container, microVM, or restricted jail.

### 4. Filesystem Access

- **Mechanism:** `--allow-unrestricted-file-access` flag default behavior.
- **Scope & Meaning:** By default, `@playwright/mcp` restricts navigation to `file://` URLs and constrains file reads to workspace directories. However, artifacts (screenshots, traces, recordings) are written to local disk (e.g., `--output-dir`).
- **Limitation:** The agent process retains developer file read/write permissions on the host filesystem.

### 5. Network Access

- **Mechanism:** `--allowed-origins` and `--blocked-origins`.
- **Scope & Meaning:** Outbound network requests are permitted by default across reachable network adapters.
- **Requirement:** Frontier Engineer policy restricts navigation to `localhost`, `127.0.0.1`, `[::1]`, and explicitly whitelisted staging origins. Access to cloud metadata services (`169.254.169.254`) is strictly prohibited.

### 6. Website Interaction & External Side Effects

- **Mechanism:** Human-in-the-Loop approval for external origins (Layer E).
- **Scope & Meaning:** Interacting with pages (clicking buttons, filling forms) triggers real HTTP mutations on target web applications.
- **Requirement:** Autonomous interaction is confined to local development or disposable staging instances. Interacting with external payment, authentication, or production systems requires explicit developer confirmation.

---

## Defense-in-Depth Enforcement Boundaries

```text
┌─────────────────────────────────────────────────────────────────┐
│ Layer E: Human-in-the-Loop Approval                             │
│ External or staging form submissions require developer consent  │
├─────────────────────────────────────────────────────────────────┤
│ Layer D: Behavioral Rules (Frontier Engineer Rules System)      │
│ Prohibit real credentials; use only synthetic test fixtures     │
├─────────────────────────────────────────────────────────────────┤
│ Layer C: Destination & Origin Restrictions                      │
│ Constrained to localhost, 127.0.0.1; cloud metadata blocked     │
├─────────────────────────────────────────────────────────────────┤
│ Layer B: Host / Antigravity Configuration Filtering             │
│ Registered dormant ("disabled": true) in mcp_config.json        │
├─────────────────────────────────────────────────────────────────┤
│ Layer A: In-Memory Profile Isolation (--isolated) & Headless    │
│ In-memory profiles; zero access to developer personal sessions  │
└─────────────────────────────────────────────────────────────────┘
```

### Layer A: In-Memory Profile Isolation & Headless Mode

- `--isolated`: Ensures the session starts with a fresh, temporary browser profile. Discards state upon exit.
- `--headless`: Runs without opening visible desktop windows. **Note:** Headless mode is an operational convenience to prevent desktop window hijacking; it is **not** a security boundary.

### Layer B: Host Configuration

Server is kept dormant (`"disabled": true`) in `mcp_config.json` until explicitly enabled by the developer.

### Layer C: Destination Restrictions

- Permitted: `http://localhost:*`, `http://127.0.0.1:*`, `http://[::1]:*`, and explicitly designated test staging origins.
- Prohibited: Cloud metadata endpoints (`169.254.169.254`), non-test public domains, internal network management interfaces.

### Layer D: Synthetic Fixture Policy

The agent is strictly prohibited from entering real passwords, API tokens, or personal identity numbers. All test interactions must use synthetic test fixtures (e.g., `test-user@example.com`, `synthetic-pass-123`).

### Layer E: Human Approval Gates

Interactions that cause remote state alterations outside local development servers require explicit developer confirmation.

---

## Audit Logging

Every navigation, interaction, and screenshot command is logged with:

- Target URL and origin verification
- Action type (`browser_navigate`, `browser_fill_form`, `browser_click`, `browser_take_screenshot`)
- Time elapsed and exit status
- Any uncaught console errors detected during the page lifecycle
