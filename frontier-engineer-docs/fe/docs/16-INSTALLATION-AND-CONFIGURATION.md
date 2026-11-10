# Part 16 — Installation and Configuration

## 16.1 Development environment

Recommended:

- Windows 10/11
- Google Antigravity
- Node.js LTS
- npm
- Git
- GitHub account
- Code editor with Markdown support

## 16.2 Initial setup

The development agent first verifies the available Antigravity CLI and plugin capabilities. Do not assume command names or plugin directory locations from older versions.

Conceptual setup:

```bash
node --version
npm --version
git --version
```

Then:

1. Create the Frontier Engineer repository
2. Initialize Git
3. Create the source structure
4. Verify plugin metadata
5. Create agent definitions
6. Create skills
7. Add rules
8. Configure integrations
9. Validate the package
10. Test installation in a clean environment

## 16.3 Configuration principles

- Keep optional integrations optional
- Do not commit secrets
- Document every required environment variable
- Validate all configuration
- Provide defaults only when safe
- Avoid undocumented environment variables

## 16.4 Installation acceptance

The plugin is not declared installable until:

- Its manifest passes official validation
- Required files are present
- Agent definitions are recognized
- Skills are discovered
- Rules load correctly
- Integrations work when configured
- The package works in a clean Antigravity environment
