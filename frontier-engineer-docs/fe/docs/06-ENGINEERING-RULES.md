# Part 06 — Engineering Rules

Rules are persistent standards that agents must follow. They should not duplicate entire skill documents.

## 6.1 Global rules

1. Inspect before modifying.
2. Follow existing project conventions.
3. Do not invent missing functionality.
4. Avoid unnecessary dependencies.
5. Preserve existing behavior.
6. Keep changes focused.
7. Use clear and maintainable code.
8. Handle errors explicitly.
9. Validate untrusted input.
10. Document important architectural decisions.
11. Test relevant functionality.
12. Report limitations honestly.

## 6.2 Frontend rules

- Use reusable components
- Maintain consistent spacing
- Follow established design tokens
- Provide responsive layouts
- Support keyboard navigation
- Include loading, empty, and error states
- Avoid unnecessary component complexity
- Avoid hardcoded secrets
- Handle API failures
- Test interactions

## 6.3 Backend rules

- Validate every untrusted request
- Enforce authorization server-side
- Never trust client-provided identity or roles
- Use safe database access patterns
- Handle failures consistently
- Protect sensitive information
- Apply appropriate rate limits
- Use secure session practices
- Avoid leaking internal errors

## 6.4 Database rules

- Use appropriate indexes
- Preserve data integrity
- Design migrations carefully
- Avoid destructive migrations without approval
- Avoid unnecessary duplicate data
- Use transactions where needed
- Protect sensitive records
- Consider query performance

## 6.5 Testing rules

- Test new functionality
- Add regression tests for bug fixes
- Do not remove failing tests simply to achieve a green suite
- Report skipped tests
- Report blocked tests
- Never fabricate test results

## 6.6 Documentation rules

Documentation should explain:

- What the system does
- Why important decisions were made
- How components interact
- How to configure the system
- How to run it
- How to test it
- Known limitations
