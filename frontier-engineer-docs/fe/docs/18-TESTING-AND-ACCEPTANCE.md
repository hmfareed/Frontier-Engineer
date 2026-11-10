# Part 18 — Testing and Acceptance Criteria

## 18.1 Foundation acceptance

- Valid plugin structure
- Manifest conforms to official schema
- No broken internal paths
- All agent definitions have valid metadata
- All skill definitions have valid metadata
- Rules are discoverable
- Documentation links work

## 18.2 Agent acceptance

Test the coordinator against:

1. A simple UI change
2. A complex feature
3. An unfamiliar repository
4. A debugging request
5. A security audit
6. A full architecture review

Evaluate whether it selects appropriate procedures and reports results accurately.

## 18.3 Skill acceptance

Each skill must:

- Have a clear purpose
- Have valid metadata
- Contain actionable procedures
- Avoid conflicting instructions
- Provide meaningful deliverables
- Be discoverable by the supported skill mechanism

## 18.4 Security acceptance

- No committed credentials
- No unrestricted destructive defaults
- Human confirmation for sensitive operations
- Clear integration permissions
- No unsupported claims about security verification

## 18.5 Release acceptance

A release requires:

- All required checks passed
- No critical known defects
- Clean installation verified
- Documentation complete
- Changelog updated
- Version correctly assigned
- Package contents reviewed
