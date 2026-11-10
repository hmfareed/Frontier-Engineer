# Deep Research: Evidence Synthesis, Source Verification, and Fact-Checking Guide

This reference provides methodologies for conducting rigorous technical research, establishing source hierarchy, evaluating recency, and preventing hallucinated technical claims.

## 1. The Authoritative Source Hierarchy

When conducting technical investigations, evaluate information against this strict priority ladder:

| Rank       | Source Tier                                  | Examples                                                                                                       | Trust Level & Usage                                                                                          |
| :--------- | :------------------------------------------- | :------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| **Tier 1** | **Official Documentation & Language Specs**  | MDN, nodejs.org, docs.python.org, RFCs, official framework documentation.                                      | **Primary Source:** Authoritative definitions of APIs, signatures, and configuration.                        |
| **Tier 2** | **Official Repositories & Release Notes**    | GitHub releases, CHANGELOG.md, official package commits, issue tracker resolutions by maintainers.             | **Ground Truth:** Confirms recent breaking changes, version deprecations, and bug fixes.                     |
| **Tier 3** | **Security Advisories & Standards Bodies**   | CVE databases, NIST NVD, GitHub Advisory Database, OWASP, ISO/IEC standards.                                   | **Authoritative for Security:** Definitive assessment of vulnerabilities and CVSS scores.                    |
| **Tier 4** | **Reputable Technical Publications & Books** | Engineering blogs by technology creators (e.g. Netflix TechBlog, AWS Architecture Blog), peer-reviewed papers. | **Architectural Evidence:** Informs design trade-offs, scaling limits, and operational experience.           |
| **Tier 5** | **Community Q&A and Forums**                 | StackOverflow, Reddit, personal blog posts.                                                                    | **Supplementary Only:** Use to identify potential failure patterns; must be cross-verified against Tier 1/2. |

---

## 2. Temporal Validity and Version Anchoring

Technical facts expire. What was best practice in React 16 is an anti-pattern in React 19. When citing findings:

1. **Record the Target Version:** Always state the version of the library or runtime being researched (e.g. `Node.js v22.x`, `PostgreSQL 16`).
2. **Record the Evidence Date:** Note the date when documentation or release notes were verified.
3. **Cross-Check Breaking Changes:** If an approach was published >2 years ago, explicitly inspect the latest major version changelog for deprecations or API removals.

---

## 3. Fact vs. Assumption Labeling

Every technical research synthesis must maintain strict separation between three categories:

- **Verified Fact:** Direct quote, code snippet, or behavioral assertion confirmed by Tier 1/2 documentation or local execution.
- **Inferred Assumption:** Logical conclusion derived from known facts, but not explicitly verified by primary documentation (must be explicitly labeled as _"Assumption"_).
- **Unresolved Question:** Missing information that requires access to production logs, proprietary documentation, or human stakeholder decision.
