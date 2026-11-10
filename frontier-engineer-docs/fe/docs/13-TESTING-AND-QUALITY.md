# Part 13 — Testing and Quality

## 13.1 Testing layers

- **Unit testing:** verify individual functions and components
- **Integration testing:** verify interactions between system components
- **End-to-end testing:** verify real user workflows
- **Regression testing:** verify existing functionality remains intact
- **Security testing:** evaluate security behavior and known vulnerabilities
- **Performance testing:** measure latency, resource consumption, and throughput where appropriate

## 13.2 Test selection

Select tests based on the changes made:

- CSS change: visual inspection and relevant UI checks
- API change: unit and integration tests
- Authentication change: authentication and authorization tests
- Database migration: migration and integrity tests
- Payment change: payment workflow and failure-state tests

## 13.3 Verification report

```markdown
# Verification Report

## Changes
What was implemented?

## Tests Executed
- Unit tests:
- Integration tests:
- End-to-end tests:

## Results
Passed:
Failed:
Skipped:
Blocked:

## Security
Findings:

## Known Limitations
Remaining issues:

## Final Status
- Verified
- Partially verified
- Not verified
```

## 13.4 Quality evaluation

Proposed internal evaluation weighting:

| Category | Weight |
| --- | --- |
| Correctness | 20% |
| Planning | 15% |
| Code quality | 15% |
| Security | 15% |
| Testing | 15% |
| UI/UX | 10% |
| Research | 5% |
| Honest reporting | 5% |
| **Total** | **100%** |

**Target:** at least 85/100 on the defined evaluation suite (see `26-EVALUATION-SUITE.md`), with no critical security failures or fabricated verification claims.

This is a proposed acceptance threshold, not an existing measured score.
