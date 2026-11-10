---
name: "deep-research"
description: "Use when investigating unfamiliar technologies, researching framework/library compatibility, verifying API signatures, evaluating technical alternatives, cross-referencing security advisories, or synthesizing technical evidence."
---

# Deep Research — Technical Investigation and Authoritative Evidence Synthesis

> Generated from `specs/skills/deep-research.md` by `scripts/generate-antigravity-skills.ts`. Edit the canonical specification, not this file.

## Purpose

The Deep Research skill provides a disciplined methodology for investigating unfamiliar technologies, complex APIs, library compatibility, and technical trade-offs. It ensures that engineering decisions are grounded in verified, authoritative primary sources, current version specifications, and explicit trade-off analyses, preventing reliance on stale forum advice or hallucinated capabilities.

## Activation criteria

Activate this skill when:

- Investigating an unfamiliar framework, library, API, or database technology.
- Resolving dependency compatibility conflicts, peer dependency warnings, or breaking changes.
- Evaluating multiple competing technology choices for a new project or subsystem.
- Assessing security advisories, CVE reports, or regulatory requirements.
- Determining whether an official platform API supports a requested feature.

## Non-activation guidelines

Do not activate this skill when:

- Implementing already-decided features using existing codebase conventions.
- Debugging local syntax errors or simple runtime exceptions (use Advanced Debugging).
- Authoring component unit tests for known interfaces.
- Formatting code or modifying visual layouts.

## Required context and inputs

Before initiating research:

1. **The Research Objective:** Specific technical question or hypothesis to prove or disprove.
2. **Current Project Environment:** Runtime versions, framework versions, operating system, and target deployment platform.
3. **Constraints:** Licensing requirements (MIT, Apache 2, GPL limits), package size limits, security boundaries, and operational budget.
4. **Authoritative Sources:** Official documentation portals, repository URLs, and release note locations.

## Operating procedure

Execute the following ten-step technical research workflow:

1. **Define the Research Question:** Formulate a precise, bounded technical question (_"Does Next.js 15 support WebSocket streaming in App Router Route Handlers natively?"_).
2. **Identify What Must Be Verified:** List concrete facts needed (API signatures, runtime support, breaking changes, performance bounds).
3. **Prioritize Official Documentation:** Consult Tier 1 primary sources (MDN, official language/framework docs) first.
4. **Search for Current and Relevant Sources:** Ensure consulted sources match the exact major version used in the project. Reject outdated blog posts from superseded versions.
5. **Compare Competing Approaches:** If evaluating alternatives, analyze at least two viable solutions across performance, maintainability, community health, and license terms.
6. **Verify Version Compatibility:** Inspect `package.json` peer dependencies, node engine ranges, and native binary prerequisites.
7. **Identify Conflicting Information:** If sources disagree, cross-reference against official GitHub issue trackers, commit logs, or run a local reproduction script to verify ground truth.
8. **Distinguish Facts from Assumptions:** Label statements as verified facts, plausible inferences, or unverified assumptions.
9. **Summarize Findings:** Synthesize findings into clear technical prose with executive summary and detailed trade-off analysis.
10. **Provide Recommendations and Citations:** Conclude with an actionable recommendation, citing exact URLs, documentation chapters, and dates checked.

## Technical and engineering standards

- **Source Priority Rule:** Strictly respect the source hierarchy: Official Docs > Official Repos & Release Notes > Standards & Security Advisories > Reputable Tech Blogs > Community Forums.
- **Never Fabricate:** Never invent API parameters, method names, benchmarks, or compatibility claims. If an API is undocumented or unclear, label it explicitly as unverified.
- **Temporal Anchoring:** Always state the version and date of consulted evidence.
- **Reproducible Evidence:** Whenever evaluating an unclear edge-case behavior, write a small local proof-of-concept test script to establish definitive empirical evidence.

## Verification and evidence requirements

- Cite specific documentation sections, URLs, or official changelog entries for all factual assertions.
- Explicitly state which version of the software was inspected.
- State explicitly if any question could not be verified due to lack of public documentation or access.

## Expected outputs and deliverables

- **Technical Research Report:** Structured briefing containing executive summary, methodology, detailed findings, and recommendations.
- **Alternative Comparison Matrix:** Table comparing options across key technical dimensions.
- **Compatibility & Migration Advisory:** Clear warning of breaking changes, peer dependency constraints, or deprecation notices.
- **Source Citations:** Formatted list of authoritative references.

## Risks, boundaries and failure modes

- **Stale Information Hazard:** Applying advice written for an obsolete version that causes silent breakage or security flaws.
- **Marketing Bias:** Believing landing page claims of library authors without verifying open GitHub issues or real-world benchmarks.
- **Unverified AI Hallucination:** Generating fictional API signatures because they sound plausible.

## Progressive disclosure references

For source hierarchy standards, fact vs. assumption criteria, and verification templates:

- [Deep Research: Evidence Synthesis, Source Verification, and Fact-Checking Guide](./references/evidence-synthesis-guide.md)
