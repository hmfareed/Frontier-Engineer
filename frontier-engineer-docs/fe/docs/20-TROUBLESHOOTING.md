# Part 20 — Troubleshooting

| Problem | Investigation |
| --- | --- |
| Plugin not detected | Check official discovery locations and manifest |
| Agent unavailable | Validate agent metadata and supported discovery |
| Skill not activated | Check skill directory, metadata and description |
| MCP connection fails | Check command, credentials, network and logs |
| Browser testing fails | Check browser installation and MCP permissions |
| Validation fails | Inspect schema errors and file paths |
| Tests fail | Reproduce and investigate failures |
| Incorrect project analysis | Reinspect manifests and source files |
| Agent repeats work | Review task tracking and project context |
| Context becomes too large | Use concise project profiles and progressive disclosure |

## 20.1 Diagnostic requirements

When an error occurs, the agent reports:

- Error message
- Relevant component
- Reproduction steps
- Likely cause
- Evidence
- Recommended fix
- Whether the issue has been resolved
