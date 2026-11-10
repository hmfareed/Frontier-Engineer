# Fixtures

Deliberately invalid inputs used by the unit tests. Every repository-wide validator excludes `tests/fixtures/`, so these files must never cause production validation to fail.

| File | Purpose |
| --- | --- |
| `valid-plugin.json` | Manifest that satisfies the verified schema |
| `invalid-plugin.json` | Unknown property and an invalid `name` |
| `broken.json` | Malformed JSON syntax |
| `valid-skill.md` | SKILL.md with compliant frontmatter |
| `invalid-skill.md` | SKILL.md missing `description` |
| `broken-frontmatter.md` | Unclosed YAML frontmatter block |
| `valid.yaml` | Valid YAML document |
| `invalid.yaml` | Invalid YAML document |
| `broken-link.md` | Markdown with a link to a nonexistent file |
